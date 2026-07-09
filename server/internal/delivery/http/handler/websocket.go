package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

const (
	defaultWriteWait  = 10 * time.Second
	defaultPongWait   = 60 * time.Second
	defaultPingPeriod = (defaultPongWait * 9) / 10
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WebSocketHandler struct {
	hub         *ws.Hub
	authUseCase domain.AuthUseCase
	callUseCase domain.CallUseCase
	userUseCase domain.UserUseCase
	log         *slog.Logger

	writeWait  time.Duration
	pongWait   time.Duration
	pingPeriod time.Duration
}

func NewWebSocketHandler(hub *ws.Hub, authUseCase domain.AuthUseCase, callUseCase domain.CallUseCase, userUseCase domain.UserUseCase, log *slog.Logger) *WebSocketHandler {
	return &WebSocketHandler{
		hub:         hub,
		authUseCase: authUseCase,
		callUseCase: callUseCase,
		userUseCase: userUseCase,
		log:         log,
		writeWait:   defaultWriteWait,
		pongWait:    defaultPongWait,
		pingPeriod:  defaultPingPeriod,
	}
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

	h.hub.RegisterClient(client)

	if err := h.userUseCase.UpdateStatus(user.ID, domain.StatusOnline); err != nil {
		h.log.Warn("failed to set user online", "user_id", user.ID, "error", err)
	}

	// Clean up stale calls left from previous sessions (e.g. app crash / disconnect)
	if err := h.callUseCase.EndAllActiveCalls(user.ID); err != nil {
		h.log.Warn("failed to cleanup stale calls", "user_id", user.ID, "error", err)
	}

	go h.writePump(client)
	go h.readPump(client)
}

func (h *WebSocketHandler) readPump(client *ws.Client) {
	defer func() {
		h.hub.UnregisterClient(client)
		client.Conn.Close()
		if err := h.userUseCase.UpdateStatus(client.UserID, domain.StatusOffline); err != nil {
			h.log.Warn("failed to set user offline", "user_id", client.UserID, "error", err)
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
	case "webrtc_offer":
		h.handleWebRTCOffer(client, msg)
	case "webrtc_answer":
		h.handleWebRTCAnswer(client, msg)
	case "webrtc_ice_candidate":
		h.handleWebRTCICECandidate(client, msg)
	case "voice_call_ring":
		h.handleVoiceCallRing(client, msg)
	case "voice_call_cancel":
		h.handleVoiceCallCancel(client, msg)
	case "screen_share_started":
		h.handleScreenShareStarted(client)
	case "screen_share_stopped":
		h.handleScreenShareStopped(client)
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
	h.hub.SetClientChannel(client.UserID, &channelID)
}

// --- Call Signalling ---

func (h *WebSocketHandler) handleCallStart(client *ws.Client, msg *ws.Message) {
	var payload struct {
		ReceiverID string `json:"receiver_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.sendError(client, "invalid call_start payload")
		return
	}

	receiverID, err := uuid.Parse(payload.ReceiverID)
	if err != nil {
		h.sendError(client, "invalid receiver_id")
		return
	}

	call, err := h.callUseCase.StartCall(client.UserID, receiverID)
	if err != nil {
		h.log.Warn("call_start failed",
			"caller_id", client.UserID,
			"receiver_id", receiverID,
			"error", err,
		)
		h.sendError(client, err.Error())
		return
	}

	h.log.Info("call started",
		"call_id", call.ID,
		"caller_id", client.UserID,
		"receiver_id", receiverID,
	)

	h.hub.SendToUser(receiverID, &ws.Message{
		Type: "incoming_call",
		Payload: mustMarshal(map[string]interface{}{
			"call_id":   call.ID.String(),
			"caller_id": call.CallerID.String(),
		}),
	})

	h.hub.SendToUser(client.UserID, &ws.Message{
		Type: "call_started",
		Payload: mustMarshal(map[string]interface{}{
			"call_id": call.ID.String(),
		}),
	})
}

func (h *WebSocketHandler) handleCallAccept(client *ws.Client, msg *ws.Message) {
	var payload struct {
		CallID string `json:"call_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.sendError(client, "invalid call_accept payload")
		return
	}

	callID, err := uuid.Parse(payload.CallID)
	if err != nil {
		h.sendError(client, "invalid call_id")
		return
	}

	if err := h.callUseCase.AcceptCall(callID); err != nil {
		h.log.Warn("call_accept failed",
			"call_id", callID,
			"user_id", client.UserID,
			"error", err,
		)
		h.sendError(client, err.Error())
		return
	}

	call, err := h.callUseCase.GetActiveCall(client.UserID)
	if err != nil {
		h.sendError(client, "failed to get call")
		return
	}

	h.log.Info("call accepted",
		"call_id", callID,
		"caller_id", call.CallerID,
		"receiver_id", client.UserID,
	)

	h.hub.SendToUser(call.CallerID, &ws.Message{
		Type: "call_accepted",
		Payload: mustMarshal(map[string]interface{}{
			"call_id": call.ID.String(),
		}),
	})

	h.hub.SendToUser(client.UserID, &ws.Message{
		Type: "call_accepted",
		Payload: mustMarshal(map[string]interface{}{
			"call_id": call.ID.String(),
		}),
	})
}

func (h *WebSocketHandler) handleCallReject(client *ws.Client, msg *ws.Message) {
	var payload struct {
		CallID string `json:"call_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.sendError(client, "invalid call_reject payload")
		return
	}

	callID, err := uuid.Parse(payload.CallID)
	if err != nil {
		h.sendError(client, "invalid call_id")
		return
	}

	call, err := h.callUseCase.GetActiveCall(client.UserID)
	if err != nil {
		h.sendError(client, "failed to get call")
		return
	}

	if err := h.callUseCase.RejectCall(callID); err != nil {
		h.log.Warn("call_reject failed",
			"call_id", callID,
			"user_id", client.UserID,
			"error", err,
		)
		h.sendError(client, err.Error())
		return
	}

	h.log.Info("call rejected",
		"call_id", callID,
		"caller_id", call.CallerID,
		"rejected_by", client.UserID,
	)

	h.hub.SendToUser(call.CallerID, &ws.Message{
		Type: "call_rejected",
		Payload: mustMarshal(map[string]interface{}{
			"call_id": callID.String(),
		}),
	})
}

func (h *WebSocketHandler) handleCallEnd(client *ws.Client, msg *ws.Message) {
	var payload struct {
		CallID string `json:"call_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.sendError(client, "invalid call_end payload")
		return
	}

	callID, err := uuid.Parse(payload.CallID)
	if err != nil {
		h.sendError(client, "invalid call_id")
		return
	}

	call, err := h.callUseCase.GetActiveCall(client.UserID)
	if err != nil {
		h.sendError(client, "failed to get call")
		return
	}

	if err := h.callUseCase.EndCall(callID); err != nil {
		h.log.Warn("call_end failed",
			"call_id", callID,
			"user_id", client.UserID,
			"error", err,
		)
		h.sendError(client, err.Error())
		return
	}

	otherID := call.CallerID
	if otherID == client.UserID {
		otherID = call.ReceiverID
	}

	h.log.Info("call ended",
		"call_id", callID,
		"ended_by", client.UserID,
		"other_party", otherID,
	)

	h.hub.SendToUser(otherID, &ws.Message{
		Type: "call_ended",
		Payload: mustMarshal(map[string]interface{}{
			"call_id": callID.String(),
		}),
	})

	h.hub.SendToUser(client.UserID, &ws.Message{
		Type: "call_ended",
		Payload: mustMarshal(map[string]interface{}{
			"call_id": callID.String(),
		}),
	})
}

// --- WebRTC Signalling ---

func (h *WebSocketHandler) handleWebRTCOffer(client *ws.Client, msg *ws.Message) {
	var payload struct {
		TargetUserID string          `json:"target_user_id"`
		SDP          json.RawMessage `json:"sdp"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.sendError(client, "invalid webrtc_offer payload")
		return
	}

	targetID, err := uuid.Parse(payload.TargetUserID)
	if err != nil {
		h.sendError(client, "invalid target_user_id")
		return
	}

	h.log.Info("forwarding WebRTC offer",
		"from_user_id", client.UserID,
		"target_user_id", targetID,
	)

	h.hub.SendToUser(targetID, &ws.Message{
		Type: "webrtc_offer",
		Payload: mustMarshal(map[string]interface{}{
			"from_user_id": client.UserID.String(),
			"sdp":          payload.SDP,
		}),
	})
}

func (h *WebSocketHandler) handleWebRTCAnswer(client *ws.Client, msg *ws.Message) {
	var payload struct {
		TargetUserID string          `json:"target_user_id"`
		SDP          json.RawMessage `json:"sdp"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.sendError(client, "invalid webrtc_answer payload")
		return
	}

	targetID, err := uuid.Parse(payload.TargetUserID)
	if err != nil {
		h.sendError(client, "invalid target_user_id")
		return
	}

	h.log.Info("forwarding WebRTC answer",
		"from_user_id", client.UserID,
		"target_user_id", targetID,
	)

	h.hub.SendToUser(targetID, &ws.Message{
		Type: "webrtc_answer",
		Payload: mustMarshal(map[string]interface{}{
			"from_user_id": client.UserID.String(),
			"sdp":          payload.SDP,
		}),
	})
}

func (h *WebSocketHandler) handleWebRTCICECandidate(client *ws.Client, msg *ws.Message) {
	var payload struct {
		TargetUserID string          `json:"target_user_id"`
		Candidate    json.RawMessage `json:"candidate"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.sendError(client, "invalid webrtc_ice_candidate payload")
		return
	}

	targetID, err := uuid.Parse(payload.TargetUserID)
	if err != nil {
		h.sendError(client, "invalid target_user_id")
		return
	}

	h.log.Debug("forwarding WebRTC ICE candidate",
		"from_user_id", client.UserID,
		"target_user_id", targetID,
	)

	h.hub.SendToUser(targetID, &ws.Message{
		Type: "webrtc_ice_candidate",
		Payload: mustMarshal(map[string]interface{}{
			"from_user_id": client.UserID.String(),
			"candidate":    payload.Candidate,
		}),
	})
}

func (h *WebSocketHandler) handleVoiceCallRing(client *ws.Client, msg *ws.Message) {
	var payload struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err == nil {
		h.log.Info("voice call ring broadcast",
			"from_user_id", client.UserID,
			"channel_id", payload.ChannelID,
		)
	}
	h.hub.BroadcastMessage(&ws.Message{Type: "voice_call_ring", Payload: msg.Payload})
}

func (h *WebSocketHandler) handleVoiceCallCancel(client *ws.Client, msg *ws.Message) {
	var payload struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err == nil {
		h.log.Info("voice call cancel broadcast",
			"from_user_id", client.UserID,
			"channel_id", payload.ChannelID,
		)
	}
	h.hub.BroadcastMessage(&ws.Message{Type: "voice_call_cancel", Payload: msg.Payload})
}

func (h *WebSocketHandler) handleScreenShareStarted(client *ws.Client) {
	h.log.Info("screen share started", "user_id", client.UserID)
	h.hub.BroadcastMessage(&ws.Message{
		Type:    "screen_share_started",
		Payload: mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}),
	})
}

func (h *WebSocketHandler) handleScreenShareStopped(client *ws.Client) {
	h.log.Info("screen share stopped", "user_id", client.UserID)
	h.hub.BroadcastMessage(&ws.Message{
		Type:    "screen_share_stopped",
		Payload: mustMarshal(map[string]interface{}{"user_id": client.UserID.String()}),
	})
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
