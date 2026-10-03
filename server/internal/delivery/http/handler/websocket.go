package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/vycord/server/internal/delivery/http/ratelimit"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

const (
	defaultWriteWait  = 10 * time.Second
	defaultPongWait   = 60 * time.Second
	defaultPingPeriod = (defaultPongWait * 9) / 10

	// callStartRateLimit/Window — сколько call_start пользователь может прислать
	// за окно. Петля «Позвонить → Отменить» иначе спамит собеседника
	// пропущенными и нагружает БД под общим mutex звонков.
	callStartRateLimit  = 10
	callStartRateWindow = time.Minute
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// GuestMirror forwards a member's own media events to the guests of the call
// they are in. Optional: nil keeps the pre-guest behaviour.
type GuestMirror interface {
	MirrorFromUser(userID uuid.UUID, msgType string, payload json.RawMessage)
}

type WebSocketHandler struct {
	hub           *ws.Hub
	guestMirror   GuestMirror
	authUseCase   domain.AuthUseCase
	callUseCase   domain.CallUseCase
	userUseCase   domain.UserUseCase
	channelAccess domain.ChannelAccessChecker
	log           *slog.Logger
	callStarts    *ratelimit.Limiter // ключ — user_id звонящего

	writeWait  time.Duration
	pongWait   time.Duration
	pingPeriod time.Duration
}

func NewWebSocketHandler(hub *ws.Hub, authUseCase domain.AuthUseCase, callUseCase domain.CallUseCase, userUseCase domain.UserUseCase, channelAccess domain.ChannelAccessChecker, log *slog.Logger) *WebSocketHandler {
	return &WebSocketHandler{
		hub:           hub,
		authUseCase:   authUseCase,
		callUseCase:   callUseCase,
		userUseCase:   userUseCase,
		channelAccess: channelAccess,
		log:           log,
		callStarts:    ratelimit.New(callStartRateLimit, callStartRateWindow),
		writeWait:     defaultWriteWait,
		pongWait:      defaultPongWait,
		pingPeriod:    defaultPingPeriod,
	}
}

// SetGuestMirror installs the mirror. Called once from main.go.
func (h *WebSocketHandler) SetGuestMirror(m GuestMirror) { h.guestMirror = m }

func (h *WebSocketHandler) mirrorToGuests(userID uuid.UUID, msgType string, payload json.RawMessage) {
	if h.guestMirror == nil {
		return
	}
	h.guestMirror.MirrorFromUser(userID, msgType, payload)
}

func (h *WebSocketHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	user, err := h.authUseCase.ValidateToken(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Error("failed to upgrade connection", "error", err)
		return
	}

	client := &ws.Client{
		UserID: user.ID,
		Conn:   conn,
		Send:   make(chan []byte, 512),
	}

	// Снимок звонка пишется прямо в client.Send, а не через хаб: регистрация
	// в хабе асинхронна, и SendToUser сразу после RegisterClient может не
	// найти клиента. Делается ДО RegisterClient: пока клиент не зарегистрирован,
	// канал Send принадлежит только этому хендлеру (буфер пуст, запись не
	// блокирует), а после регистрации дубль-сессия может сделать close(Send)
	// и запись упала бы паникой «send on closed channel».
	client.Send <- mustMarshal(&ws.Message{
		Type:    "call_state",
		Payload: mustMarshal(map[string]any{"call": h.callUseCase.OnConnect(user.ID)}),
	})

	h.hub.RegisterClient(client)

	if err := h.userUseCase.UpdateStatus(user.ID, domain.StatusOnline); err != nil {
		h.log.Warn("failed to set user online", "user_id", user.ID, "error", err)
	}

	go h.writePump(client)
	go h.readPump(client)
}

func (h *WebSocketHandler) readPump(client *ws.Client) {
	defer func() {
		// Snapshot BEFORE unregistering: if a reconnect already replaced this
		// client, this is a stale connection dying late (pongWait) — marking
		// the user offline would override the live connection's online status.
		wasCurrent := h.hub.IsCurrentClient(client)
		h.hub.UnregisterClient(client)
		client.Conn.Close()
		if wasCurrent {
			if err := h.userUseCase.UpdateStatus(client.UserID, domain.StatusOffline); err != nil {
				h.log.Warn("failed to set user offline", "user_id", client.UserID, "error", err)
			}
			if err := h.userUseCase.UpdateLastSeen(client.UserID, time.Now()); err != nil {
				h.log.Warn("failed to update last seen", "user_id", client.UserID, "error", err)
			}
			h.callUseCase.OnDisconnect(client.UserID)
		}
	}()

	client.Conn.SetReadDeadline(time.Now().Add(h.pongWait))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(h.pongWait))
		return nil
	})

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				h.log.Error("websocket error", "error", err, "user_id", client.UserID)
			}
			break
		}

		var msg ws.Message
		if err := json.Unmarshal(message, &msg); err != nil {
			h.log.Warn("failed to parse message", "error", err, "user_id", client.UserID)
			continue
		}

		h.handleMessage(client, &msg)
	}
}

func (h *WebSocketHandler) writePump(client *ws.Client) {
	ticker := time.NewTicker(h.pingPeriod)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(h.writeWait))
			if !ok {
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := client.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(h.writeWait))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *WebSocketHandler) handleMessage(client *ws.Client, msg *ws.Message) {
	switch msg.Type {
	case "join_channel":
		h.handleJoinChannel(client, msg)
	case "call_start":
		h.handleCallStart(client, msg)
	case "call_accept":
		h.handleCallAccept(client, msg)
	case "call_reject":
		h.handleCallReject(client, msg)
	case "call_end":
		h.handleCallEnd(client, msg)
	case "voice_call_ring":
		h.handleVoiceCallRing(client, msg)
	case "voice_call_cancel":
		h.handleVoiceCallCancel(client, msg)
	case "screen_share_started":
		h.handleScreenShareStarted(client)
	case "screen_share_stopped":
		h.handleScreenShareStopped(client)
	case "mic_muted":
		h.handleMicMuted(client)
	case "mic_unmuted":
		h.handleMicUnmuted(client)
	case "camera_off":
		h.handleCameraState(client, "camera_off")
	case "camera_on":
		h.handleCameraState(client, "camera_on")
	case "connection_quality":
		h.handleConnectionQuality(client, msg)
	case "voice_joined":
		h.handleVoiceJoined(client, msg)
	case "voice_left":
		h.handleVoiceLeft(client, msg)
	case "ping":
		h.handlePing(client)
	default:
		h.log.Warn("unknown message type", "type", msg.Type, "user_id", client.UserID)
	}
}

func (h *WebSocketHandler) handleJoinChannel(client *ws.Client, msg *ws.Message) {
	var payload struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}
	if payload.ChannelID == "" {
		h.hub.SetClientChannel(client.UserID, nil)
		return
	}
	channelID, err := uuid.Parse(payload.ChannelID)
	if err != nil {
		return
	}
	if _, err := h.channelAccess.CheckChannelAccess(channelID, client.UserID); err != nil {
		h.log.Warn("join_channel denied", "user_id", client.UserID, "channel_id", channelID, "error", err)
		// Clear whatever channel the client was viewing before: access may have
		// just been revoked for the channel they are still "in" on the hub, and
		// leaving CurrentChannelID stale would keep SendToChannel delivering
		// that channel's events to them until they reconnect.
		h.hub.SetClientChannel(client.UserID, nil)
		return
	}
	h.hub.SetClientChannel(client.UserID, &channelID)
}

func (h *WebSocketHandler) handleVoiceJoined(client *ws.Client, msg *ws.Message) {
	var payload struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}
	channelID, err := uuid.Parse(payload.ChannelID)
	if err != nil {
		return
	}
	if _, err := h.channelAccess.CheckChannelAccess(channelID, client.UserID); err != nil {
		h.log.Warn("voice_joined denied", "user_id", client.UserID, "channel_id", channelID, "error", err)
		return
	}

	participants := h.hub.JoinVoiceChannel(client.UserID, channelID)
	h.log.Info("voice channel joined", "user_id", client.UserID, "channel_id", channelID)
	h.hub.BroadcastVoiceParticipants(channelID, participants)
}

// handleVoiceLeft ignores the message body — the hub already knows which
// channel client.UserID is in, so it's the sole source of truth for "which
// channel did they leave" (protects against a stale/mismatched channel_id
// in the payload).
func (h *WebSocketHandler) handleVoiceLeft(client *ws.Client, _ *ws.Message) {
	channelID, participants, ok := h.hub.LeaveVoiceChannel(client.UserID)
	if !ok {
		return
	}
	h.log.Info("voice channel left", "user_id", client.UserID, "channel_id", channelID)
	h.hub.BroadcastVoiceParticipants(channelID, participants)
}

// --- Звонки 1:1 (VYC-103) ---
// Хендлеры только разбирают payload и переводят ошибки в call_error: события
// звонка (call_ringing/accepted/ended) шлёт сам CallUseCase.

func (h *WebSocketHandler) handleCallStart(client *ws.Client, msg *ws.Message) {
	if !h.callStarts.Allow(client.UserID.String()) {
		h.log.Info("call_start rate limited", "caller_id", client.UserID)
		h.sendCallError(client, "rate_limited", "")
		return
	}
	var p struct {
		ReceiverID string `json:"receiver_id"`
	}
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		h.sendCallError(client, "not_found", "")
		return
	}
	receiverID, err := uuid.Parse(p.ReceiverID)
	if err != nil {
		h.sendCallError(client, "not_found", "")
		return
	}
	if _, err := h.callUseCase.Start(client.UserID, receiverID); err != nil {
		h.log.Info("call_start refused", "caller_id", client.UserID, "receiver_id", receiverID, "error", err)
		h.sendCallError(client, callErrorCode(err), "")
	}
}

func (h *WebSocketHandler) handleCallAccept(client *ws.Client, msg *ws.Message) {
	h.withCallID(client, msg, func(callID uuid.UUID) error { return h.callUseCase.Accept(client.UserID, callID) })
}

func (h *WebSocketHandler) handleCallReject(client *ws.Client, msg *ws.Message) {
	h.withCallID(client, msg, func(callID uuid.UUID) error { return h.callUseCase.Reject(client.UserID, callID) })
}

func (h *WebSocketHandler) handleCallEnd(client *ws.Client, msg *ws.Message) {
	var p struct {
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal(msg.Payload, &p)
	h.withCallID(client, msg, func(callID uuid.UUID) error {
		return h.callUseCase.End(client.UserID, callID, domain.CallEndReason(p.Reason))
	})
}

func (h *WebSocketHandler) withCallID(client *ws.Client, msg *ws.Message, fn func(uuid.UUID) error) {
	var p struct {
		CallID string `json:"call_id"`
	}
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		h.sendCallError(client, "not_found", "")
		return
	}
	callID, err := uuid.Parse(p.CallID)
	if err != nil {
		h.sendCallError(client, "not_found", p.CallID)
		return
	}
	if err := fn(callID); err != nil {
		h.log.Info("call action refused", "type", msg.Type, "user_id", client.UserID, "call_id", callID, "error", err)
		h.sendCallError(client, callErrorCode(err), callID.String())
	}
}

// callErrorCode — код для клиента. Запрет, блокировка и «нет такого
// пользователя» неразличимы наружу (как в canInteract).
func callErrorCode(err error) string {
	switch {
	case errors.Is(err, domain.ErrInteractionForbidden),
		errors.Is(err, domain.ErrSelfFriendship),
		errors.Is(err, domain.ErrUserNotFound):
		return "forbidden"
	case errors.Is(err, domain.ErrCallPeerOffline):
		return "offline"
	case errors.Is(err, domain.ErrCallBusy):
		return "busy"
	case errors.Is(err, domain.ErrCallNotFound):
		return "not_found"
	case errors.Is(err, domain.ErrCallInvalidState):
		return "invalid_state"
	default:
		return "internal"
	}
}

func (h *WebSocketHandler) sendCallError(client *ws.Client, code, callID string) {
	payload := map[string]string{"code": code}
	if callID != "" {
		payload["call_id"] = callID
	}
	h.hub.SendToUser(client.UserID, &ws.Message{Type: "call_error", Payload: mustMarshal(payload)})
}

func (h *WebSocketHandler) handleVoiceCallRing(client *ws.Client, msg *ws.Message) {
	h.relayVoiceCallSignal(client, msg, "voice_call_ring")
}

func (h *WebSocketHandler) handleVoiceCallCancel(client *ws.Client, msg *ws.Message) {
	h.relayVoiceCallSignal(client, msg, "voice_call_cancel")
}

// relayVoiceCallSignal forwards a channel-scoped ring/cancel notification. The
// payload carries the channel's name, so a blind BroadcastMessage would leak a
// private channel's identity to every connected client. The sender's own access
// is verified first (a client must not be able to ring for a channel it cannot
// see), then delivery is narrowed to the channel audience for private channels;
// public channels keep the pre-existing broadcast-to-everyone behavior. An
// audience-resolution error drops the event instead of broadcasting it, since
// the channel could be private, matching Hub.BroadcastVoiceParticipants.
func (h *WebSocketHandler) relayVoiceCallSignal(client *ws.Client, msg *ws.Message, msgType string) {
	var payload struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}
	channelID, err := uuid.Parse(payload.ChannelID)
	if err != nil {
		return
	}

	if _, err := h.channelAccess.CheckChannelAccess(channelID, client.UserID); err != nil {
		h.log.Warn(msgType+" denied", "user_id", client.UserID, "channel_id", channelID, "error", err)
		return
	}

	h.log.Info(msgType+" relayed", "from_user_id", client.UserID, "channel_id", channelID)

	out := &ws.Message{Type: msgType, Payload: msg.Payload}

	audience, err := h.channelAccess.GetChannelAudience(channelID)
	if err != nil {
		h.log.Warn("failed to resolve channel audience, dropping event",
			"msg_type", msgType, "channel_id", channelID, "error", err)
		return
	}
	if audience != nil {
		h.hub.SendToUsers(audience, out)
		return
	}
	h.hub.BroadcastMessage(out)
}

func (h *WebSocketHandler) handleScreenShareStarted(client *ws.Client) {
	h.log.Info("screen share started", "user_id", client.UserID)
	h.hub.BroadcastMessage(&ws.Message{
		Type:    "screen_share_started",
		Payload: mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}),
	})
	h.mirrorToGuests(client.UserID, "screen_share_started", mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}))
}

func (h *WebSocketHandler) handleScreenShareStopped(client *ws.Client) {
	h.log.Info("screen share stopped", "user_id", client.UserID)
	h.hub.BroadcastMessage(&ws.Message{
		Type:    "screen_share_stopped",
		Payload: mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}),
	})
	h.mirrorToGuests(client.UserID, "screen_share_stopped", mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}))
}

func (h *WebSocketHandler) handleMicMuted(client *ws.Client) {
	h.log.Info("mic muted", "user_id", client.UserID)
	h.hub.BroadcastMessage(&ws.Message{
		Type:    "mic_muted",
		Payload: mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}),
	})
	h.mirrorToGuests(client.UserID, "mic_muted", mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}))
}

func (h *WebSocketHandler) handleMicUnmuted(client *ws.Client) {
	h.log.Info("mic unmuted", "user_id", client.UserID)
	h.hub.BroadcastMessage(&ws.Message{
		Type:    "mic_unmuted",
		Payload: mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}),
	})
	h.mirrorToGuests(client.UserID, "mic_unmuted", mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}))
}

// handleCameraState relays camera_off / camera_on exactly like mic_muted:
// peers render the avatar instead of a black frame while the camera is off.
// No state is kept on the server — late joiners learn it from the peers'
// re-announcement on participant_joined (client side).
func (h *WebSocketHandler) handleCameraState(client *ws.Client, msgType string) {
	h.log.Info("camera state", "type", msgType, "user_id", client.UserID)
	payload := mustMarshal(map[string]interface{}{"user_id": client.UserID.String()})
	h.hub.BroadcastMessage(&ws.Message{Type: msgType, Payload: payload})
	h.mirrorToGuests(client.UserID, msgType, payload)
}

func (h *WebSocketHandler) handleConnectionQuality(client *ws.Client, msg *ws.Message) {
	var payload struct {
		Level      string  `json:"level"`
		PacketLoss float64 `json:"packet_loss"`
		RTT        float64 `json:"rtt"`
		Bitrate    float64 `json:"bitrate"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}
	switch payload.Level {
	case "good", "medium", "poor", "unknown":
	default:
		return
	}
	qualityPayload := mustMarshal(map[string]interface{}{
		"user_id":     client.UserID.String(),
		"level":       payload.Level,
		"packet_loss": payload.PacketLoss,
		"rtt":         payload.RTT,
		"bitrate":     payload.Bitrate,
	})
	h.hub.BroadcastMessage(&ws.Message{Type: "connection_quality", Payload: qualityPayload})
	h.mirrorToGuests(client.UserID, "connection_quality", qualityPayload)
}

func (h *WebSocketHandler) handlePing(client *ws.Client) {
	h.hub.SendToUser(client.UserID, &ws.Message{Type: "pong"})
}

func (h *WebSocketHandler) sendError(client *ws.Client, errMsg string) {
	h.hub.SendToUser(client.UserID, &ws.Message{
		Type: "error",
		Payload: mustMarshal(map[string]string{
			"message": errMsg,
		}),
	})
}

func mustMarshal(v interface{}) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}
