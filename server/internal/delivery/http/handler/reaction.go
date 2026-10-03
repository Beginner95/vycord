package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// ChannelSender — то, что хэндлеру реакций нужно от хаба. *ws.Hub подходит как есть.
type ChannelSender interface {
	SendToChannel(channelID uuid.UUID, message *ws.Message)
}

// GuestReactionsFanout доносит снимок до гостей звонка — их нет в хабе.
type GuestReactionsFanout interface {
	MessageReactions(channelID, messageID uuid.UUID, reactions []domain.Reaction)
}

// ReactionHandler — реакции на сообщения (VYC-106).
type ReactionHandler struct {
	uc     domain.ReactionUseCase
	hub    ChannelSender
	guests GuestReactionsFanout
	log    *slog.Logger
}

func NewReactionHandler(uc domain.ReactionUseCase, hub ChannelSender, log *slog.Logger) *ReactionHandler {
	return &ReactionHandler{uc: uc, hub: hub, log: log}
}

// SetGuestFanout подключает рассылку гостям. Вызывается один раз из main.go.
func (h *ReactionHandler) SetGuestFanout(g GuestReactionsFanout) { h.guests = g }

// reactionsPayload — и тело ответа, и WS message_reactions: клиент применяет
// одно и то же, откуда бы снимок ни пришёл.
type reactionsPayload struct {
	ChannelID uuid.UUID         `json:"channel_id"`
	MessageID uuid.UUID         `json:"message_id"`
	Reactions []domain.Reaction `json:"reactions"`
}

type reactionOp func(userID, channelID, messageID uuid.UUID, rawKey string) ([]domain.Reaction, error)

func (h *ReactionHandler) Add(w http.ResponseWriter, r *http.Request)    { h.handle(w, r, h.uc.Add) }
func (h *ReactionHandler) Remove(w http.ResponseWriter, r *http.Request) { h.handle(w, r, h.uc.Remove) }

func (h *ReactionHandler) handle(w http.ResponseWriter, r *http.Request, op reactionOp) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	messageID, err := uuid.Parse(r.PathValue("message_id"))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidMessageID, "invalid message id")
		return
	}

	reactions, err := op(userID, channelID, messageID, r.PathValue("key"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	// Пустой снимок обязан уйти как [] — по нему клиент убирает пилюли.
	if reactions == nil {
		reactions = []domain.Reaction{}
	}
	p := reactionsPayload{ChannelID: channelID, MessageID: messageID, Reactions: reactions}
	raw, _ := json.Marshal(p)
	// Ни read-state, ни звука, ни упоминаний: реакция — не новое сообщение.
	h.hub.SendToChannel(channelID, &ws.Message{Type: "message_reactions", Payload: raw})
	if h.guests != nil {
		h.guests.MessageReactions(channelID, messageID, reactions)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

func (h *ReactionHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrReactionInvalid):
		httperr.Write(w, http.StatusBadRequest, httperr.CodeReactionInvalid, "invalid reaction")
	case errors.Is(err, domain.ErrReactionLimitReached):
		httperr.Write(w, http.StatusBadRequest, httperr.CodeReactionLimitReached, "reaction limit reached")
	case errors.Is(err, domain.ErrReactionNotAllowed):
		httperr.Write(w, http.StatusBadRequest, httperr.CodeReactionNotAllowed, "reactions are not allowed on this message")
	case errors.Is(err, domain.ErrStickerNotFound):
		httperr.Write(w, http.StatusNotFound, httperr.CodeStickerNotFound, "sticker not found")
	case errors.Is(err, domain.ErrMessageNotFound):
		httperr.Write(w, http.StatusNotFound, httperr.CodeMessageNotFound, "message not found")
	case errors.Is(err, domain.ErrChannelNotFound):
		httperr.Write(w, http.StatusNotFound, httperr.CodeChannelNotFound, "channel not found")
	case errors.Is(err, domain.ErrForbidden):
		httperr.Write(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
	default:
		h.log.Error("reaction request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		httperr.Write(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}
