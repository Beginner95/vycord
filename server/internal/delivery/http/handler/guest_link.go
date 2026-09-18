package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// GuestLinkHandler — аккаунтная сторона гостевых ссылок: выпуск, список,
// отзыв, решения лобби, кик и выключатель сервера.
type GuestLinkHandler struct {
	guests  domain.GuestUseCase
	servers domain.ServerUseCase
	hub     *ws.Hub
	log     *slog.Logger
}

func NewGuestLinkHandler(guests domain.GuestUseCase, servers domain.ServerUseCase, hub *ws.Hub, log *slog.Logger) *GuestLinkHandler {
	return &GuestLinkHandler{guests: guests, servers: servers, hub: hub, log: log}
}

func (h *GuestLinkHandler) CreateLink(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	channelID, ok := h.pathUUID(w, r, "channel_id", httperr.CodeInvalidChannelID, "invalid channel id")
	if !ok {
		return
	}

	created, err := h.guests.CreateLink(channelID, userID)
	if err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	// Секрет отдаётся ровно один раз: в БД лежит только его хеш.
	writeGuestJSON(w, http.StatusCreated, created)
}

func (h *GuestLinkHandler) ListLinks(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	channelID, ok := h.pathUUID(w, r, "channel_id", httperr.CodeInvalidChannelID, "invalid channel id")
	if !ok {
		return
	}

	state, err := h.guests.ListCallGuests(channelID, userID)
	if err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	if state.Links == nil {
		state.Links = []*domain.GuestLink{}
	}
	if state.Guests == nil {
		state.Guests = []*domain.CallGuest{}
	}
	writeGuestJSON(w, http.StatusOK, state)
}

func (h *GuestLinkHandler) RevokeLink(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	linkID, ok := h.pathUUID(w, r, "id", httperr.CodeInvalidGuestLinkID, "invalid guest link id")
	if !ok {
		return
	}
	if err := h.guests.RevokeLink(linkID, userID); err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *GuestLinkHandler) Admit(w http.ResponseWriter, r *http.Request) {
	h.decide(w, r, h.guests.Admit)
}

func (h *GuestLinkHandler) Reject(w http.ResponseWriter, r *http.Request) {
	h.decide(w, r, h.guests.Reject)
}

func (h *GuestLinkHandler) decide(w http.ResponseWriter, r *http.Request, action func(guestID, userID uuid.UUID) error) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	guestID, ok := h.pathUUID(w, r, "id", httperr.CodeInvalidGuestID, "invalid guest id")
	if !ok {
		return
	}
	if err := action(guestID, userID); err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type kickGuestRequest struct {
	Ban bool `json:"ban"`
}

func (h *GuestLinkHandler) Kick(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	guestID, ok := h.pathUUID(w, r, "id", httperr.CodeInvalidGuestID, "invalid guest id")
	if !ok {
		return
	}

	// Тело необязательно: «выгнать» без бана приходит без него.
	var req kickGuestRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	if err := h.guests.Kick(guestID, userID, req.Ban); err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type setGuestLinksRequest struct {
	Enabled *bool `json:"enabled"`
}

func (h *GuestLinkHandler) SetServerGuestLinks(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, ok := h.pathUUID(w, r, "id", httperr.CodeInvalidServerID, "invalid server id")
	if !ok {
		return
	}

	var req setGuestLinksRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&req); err != nil || req.Enabled == nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	server, err := h.guests.SetServerGuestLinks(serverID, userID, *req.Enabled)
	if err != nil {
		writeGuestError(w, r, h.log, err)
		return
	}
	h.broadcastServerUpdate(serverID, server)
	writeGuestJSON(w, http.StatusOK, server)
}

// broadcastServerUpdate повторяет адресацию ServerHandler.broadcast: приватному
// серверу — только его участникам, публичному — всем подключённым.
func (h *GuestLinkHandler) broadcastServerUpdate(serverID uuid.UUID, server *domain.Server) {
	if h.hub == nil || h.servers == nil {
		return
	}
	payload, err := json.Marshal(server)
	if err != nil {
		return
	}
	msg := &ws.Message{Type: "server_update", Payload: payload}

	audience, err := h.servers.GetServerAudience(serverID)
	if err != nil {
		h.log.Error("failed to resolve server audience, dropping broadcast",
			"server_id", serverID, "message_type", msg.Type, "error", err)
		return
	}
	if audience != nil {
		h.hub.SendToUsers(audience, msg)
		return
	}
	h.hub.BroadcastMessage(msg)
}

func (h *GuestLinkHandler) pathUUID(w http.ResponseWriter, r *http.Request, name, code, message string) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(name))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, code, message)
		return uuid.Nil, false
	}
	return id, true
}
