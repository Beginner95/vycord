package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/http/ratelimit"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// guestBodyLimit — потолок тела гостевого запроса. Гость не аутентифицирован
// сервисом, поэтому читать от него мегабайты незачем.
const guestBodyLimit = 16 << 10

// GuestRateLimits — лимиты гостевой стороны. SecretFailures считает только
// НЕУДАЧНЫЕ проверки секрета: исчерпав его, IP не может ни смотреть
// предпросмотр, ни входить до конца окна.
type GuestRateLimits struct {
	Preview        *ratelimit.Limiter
	Join           *ratelimit.Limiter
	SecretFailures *ratelimit.Limiter
	Messages       *ratelimit.Limiter
}

// GuestHandler — /api/v1/guest/*. Ни один из этих маршрутов не проходит через
// RequireAuth; те, что требуют сессии, оборачиваются middleware.GuestAuth.
type GuestHandler struct {
	guests    domain.GuestUseCase
	guestChat GuestChatFanout
	messages  domain.MessageUseCase
	hub       *ws.Hub
	limits    GuestRateLimits
	log       *slog.Logger
}

func NewGuestHandler(guests domain.GuestUseCase, messages domain.MessageUseCase, hub *ws.Hub, limits GuestRateLimits, log *slog.Logger) *GuestHandler {
	return &GuestHandler{guests: guests, messages: messages, hub: hub, limits: limits, log: log}
}

type guestSecretRequest struct {
	Secret string `json:"secret"`
}

type guestJoinRequest struct {
	Secret      string `json:"secret"`
	DisplayName string `json:"display_name"`
}

type guestMessageRequest struct {
	Content string `json:"content"`
}

type guestVoiceTokenResponse struct {
	Token  string    `json:"token"`
	RoomID uuid.UUID `json:"room_id"`
}

// SetGuestChat installs the guest chat fan-out. Called once from main.go.
func (h *GuestHandler) SetGuestChat(f GuestChatFanout) { h.guestChat = f }

func (h *GuestHandler) Preview(w http.ResponseWriter, r *http.Request) {
	ip := ratelimit.ClientIP(r)
	if h.limits.SecretFailures.Exhausted(ip) || !h.limits.Preview.Allow(ip) {
		h.tooManyRequests(w)
		return
	}
	var req guestSecretRequest
	if !h.decode(w, r, &req) {
		return
	}

	preview, err := h.guests.Preview(req.Secret)
	if err != nil {
		h.countSecretFailure(ip, err)
		writeGuestError(w, r, h.log, err)
		return
	}
	writeGuestJSON(w, http.StatusOK, preview)
}

func (h *GuestHandler) Join(w http.ResponseWriter, r *http.Request) {
	ip := ratelimit.ClientIP(r)
	if h.limits.SecretFailures.Exhausted(ip) || !h.limits.Join.Allow(ip) {
		h.tooManyRequests(w)
		return
	}
	var req guestJoinRequest
	if !h.decode(w, r, &req) {
		return
	}

	result, err := h.guests.Join(req.Secret, req.DisplayName, ip)
	if err != nil {
		h.countSecretFailure(ip, err)
		writeGuestError(w, r, h.log, err)
		return
	}
	writeGuestJSON(w, http.StatusCreated, result)
}

func (h *GuestHandler) VoiceToken(w http.ResponseWriter, r *http.Request) {
	guest, ok := h.guest(w, r)
	if !ok {
		return
	}
	token, roomID, err := h.guests.IssueRoomToken(guest)
	if err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	writeGuestJSON(w, http.StatusOK, guestVoiceTokenResponse{Token: token, RoomID: roomID})
}

func (h *GuestHandler) TURNCredentials(w http.ResponseWriter, r *http.Request) {
	guest, ok := h.guest(w, r)
	if !ok {
		return
	}
	creds, err := h.guests.TURNCredentials(guest)
	if err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	// Тот же формат, что у /api/v1/turn/credentials: клиент разбирает его одним кодом.
	resp := turnCredentialsResponse{ICEServers: []iceServerResponse{}}
	if creds != nil {
		resp.ICEServers = append(resp.ICEServers, iceServerResponse{
			URLs: creds.URLs, Username: creds.Username, Credential: creds.Credential,
		})
		resp.TTLSeconds = creds.TTLSeconds
	}
	writeGuestJSON(w, http.StatusOK, resp)
}

func (h *GuestHandler) PostMessage(w http.ResponseWriter, r *http.Request) {
	guest, ok := h.guest(w, r)
	if !ok {
		return
	}
	if !h.limits.Messages.Allow(guest.Guest.ID.String()) {
		h.tooManyRequests(w)
		return
	}
	var req guestMessageRequest
	if !h.decode(w, r, &req) {
		return
	}

	msg, err := h.messages.CreateGuestMessage(guest, req.Content)
	if err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	if h.hub != nil {
		payload, mErr := json.Marshal(msg)
		if mErr == nil {
			h.hub.SendToChannel(guest.Guest.ChannelID, &ws.Message{Type: "chat_message", Payload: payload})
		}
	}
	if h.guestChat != nil {
		h.guestChat.ChatMessage(guest.Guest.ChannelID, msg, nil)
	}
	writeGuestJSON(w, http.StatusCreated, msg)
}

func (h *GuestHandler) ListMessages(w http.ResponseWriter, r *http.Request) {
	guest, ok := h.guest(w, r)
	if !ok {
		return
	}

	var afterID *uuid.UUID
	if raw := r.URL.Query().Get("after"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidMessageID, "invalid message id")
			return
		}
		afterID = &id
	}
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid limit")
			return
		}
		limit = n
	}

	list, err := h.messages.ListGuestMessages(guest, afterID, limit)
	if err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	if list == nil {
		list = []*domain.GuestChatMessage{}
	}
	writeGuestJSON(w, http.StatusOK, list)
}

func (h *GuestHandler) Leave(w http.ResponseWriter, r *http.Request) {
	guest, ok := h.guest(w, r)
	if !ok {
		return
	}
	if err := h.guests.Leave(guest); err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuestHandler) guest(w http.ResponseWriter, r *http.Request) (*domain.GuestContext, bool) {
	guest, ok := middleware.GuestFromContext(r.Context())
	if !ok {
		// Маршрут не обёрнут GuestAuth — отвечаем как на неизвестную сессию,
		// а не падаем.
		httperr.Write(w, http.StatusUnauthorized, httperr.CodeGuestSessionInvalid, "guest session invalid")
		return nil, false
	}
	return guest, true
}

func (h *GuestHandler) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, guestBodyLimit)).Decode(dst); err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return false
	}
	return true
}

// countSecretFailure засчитывает только промах по секрету: истёкшая или
// отозванная ссылка означает, что секрет был настоящий, и закрывать за это
// адрес не за что.
func (h *GuestHandler) countSecretFailure(ip string, err error) {
	if errors.Is(err, domain.ErrGuestLinkInvalid) {
		h.limits.SecretFailures.Allow(ip)
	}
}

func (h *GuestHandler) tooManyRequests(w http.ResponseWriter) {
	httperr.Write(w, http.StatusTooManyRequests, httperr.CodeRateLimited, "too many requests")
}
