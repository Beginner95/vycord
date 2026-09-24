package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/vycord/server/internal/delivery/guestws"
	"github.com/vycord/server/internal/domain"
)

// guestRelayableTypes — единственные сообщения, которые гость может прислать
// по сокету. Типы хаба (join_channel, call_start и прочие) здесь не работают:
// гостевой сокет — это не хаб.
var guestRelayableTypes = map[string]struct{}{
	"mic_muted":            {},
	"mic_unmuted":          {},
	"camera_off":           {},
	"camera_on":            {},
	"screen_share_started": {},
	"screen_share_stopped": {},
	"connection_quality":   {},
}

// GuestRealtime — то, что шлюзу нужно от guestevents.Events.
type GuestRealtime interface {
	RelayGuestSignal(guest *domain.GuestContext, msgType string, payload json.RawMessage)
	Participants(channelID uuid.UUID) *guestws.Message
}

type GuestWSHandler struct {
	guests   domain.GuestUseCase
	gateway  *guestws.Gateway
	realtime GuestRealtime
	log      *slog.Logger

	writeWait  time.Duration
	pongWait   time.Duration
	pingPeriod time.Duration
}

func NewGuestWSHandler(guests domain.GuestUseCase, gateway *guestws.Gateway, realtime GuestRealtime, log *slog.Logger) *GuestWSHandler {
	return &GuestWSHandler{
		guests: guests, gateway: gateway, realtime: realtime, log: log,
		writeWait: defaultWriteWait, pongWait: defaultPongWait, pingPeriod: defaultPingPeriod,
	}
}

// HandleWebSocket upgrades first and authenticates in the FIRST FRAME: the
// session token must never travel in a query string, where nginx would log it.
func (h *GuestWSHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.log.Warn("guest websocket upgrade failed", "error", err)
		return
	}

	guest, ok := h.authenticate(conn)
	if !ok {
		_ = conn.Close()
		return
	}

	client := &guestws.Client{
		GuestID:   guest.Guest.ID,
		ChannelID: guest.Guest.ChannelID,
		Conn:      conn,
		Send:      make(chan []byte, 64),
	}
	h.gateway.Register(client)
	h.log.Info("guest connected", "guest_id", guest.Guest.ID, "channel_id", guest.Guest.ChannelID)

	// Состояние на момент подключения: переподключившийся гость не ждёт
	// следующего события, чтобы узнать, где он.
	if guest.Guest.Status == domain.GuestStatusAdmitted {
		h.gateway.Send(client.GuestID, guestws.Marshal("admitted", map[string]string{
			"room_id": guest.Guest.ChannelID.String(),
		}))
		h.gateway.Send(client.GuestID, h.realtime.Participants(guest.Guest.ChannelID))
	} else {
		h.gateway.Send(client.GuestID, guestws.Marshal("lobby_waiting", nil))
	}

	go h.writePump(client)
	h.readPump(client, guest)
}

func (h *GuestWSHandler) authenticate(conn *websocket.Conn) (*domain.GuestContext, bool) {
	if err := conn.SetReadDeadline(time.Now().Add(domain.GuestWSAuthTimeout)); err != nil {
		return nil, false
	}
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return nil, false
	}

	var msg guestws.Message
	if err := json.Unmarshal(raw, &msg); err != nil || msg.Type != "auth" {
		return nil, false
	}
	var payload struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return nil, false
	}

	guest, err := h.guests.Authenticate(payload.Token)
	if err != nil {
		h.log.Warn("guest websocket authentication failed", "error", err)
		if errors.Is(err, domain.ErrGuestSessionInvalid) {
			// Сессия мертва навсегда (гость вышел, выгнан, звонок закрыт или
			// его сняли за отсутствие). Говорим это явно: молча закрытый сокет
			// клиент принимает за обрыв и переподключается бесконечно. Сбой БД
			// сюда не попадает — после него переподключение как раз нужно.
			h.rejectSession(conn)
		}
		return nil, false
	}
	return guest, true
}

func (h *GuestWSHandler) rejectSession(conn *websocket.Conn) {
	data, err := json.Marshal(guestws.Marshal("session_invalid", nil))
	if err != nil {
		return
	}
	_ = conn.SetWriteDeadline(time.Now().Add(h.writeWait))
	_ = conn.WriteMessage(websocket.TextMessage, data)
	_ = conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "session invalid"))
}

func (h *GuestWSHandler) readPump(client *guestws.Client, guest *domain.GuestContext) {
	defer func() {
		h.gateway.Unregister(client)
		_ = client.Conn.Close()
		h.log.Info("guest disconnected", "guest_id", client.GuestID)
	}()

	_ = client.Conn.SetReadDeadline(time.Now().Add(h.pongWait))
	client.Conn.SetPongHandler(func(string) error {
		return client.Conn.SetReadDeadline(time.Now().Add(h.pongWait))
	})
	client.Conn.SetReadLimit(16 << 10)

	for {
		_, raw, err := client.Conn.ReadMessage()
		if err != nil {
			return
		}
		var msg guestws.Message
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg.Type == "ping" {
			h.gateway.Send(client.GuestID, guestws.Marshal("pong", nil))
			continue
		}
		if _, ok := guestRelayableTypes[msg.Type]; !ok {
			continue
		}
		h.realtime.RelayGuestSignal(guest, msg.Type, msg.Payload)
	}
}

func (h *GuestWSHandler) writePump(client *guestws.Client) {
	ticker := time.NewTicker(h.pingPeriod)
	defer func() {
		ticker.Stop()
		_ = client.Conn.Close()
	}()

	for {
		select {
		case data, ok := <-client.Send:
			_ = client.Conn.SetWriteDeadline(time.Now().Add(h.writeWait))
			if !ok {
				_ = client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := client.Conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			_ = client.Conn.SetWriteDeadline(time.Now().Add(h.writeWait))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
