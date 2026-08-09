package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type MessageHandler struct {
	messageUseCase domain.MessageUseCase
	hub            *ws.Hub
	log            *slog.Logger
}

func NewMessageHandler(messageUseCase domain.MessageUseCase, hub *ws.Hub, log *slog.Logger) *MessageHandler {
	return &MessageHandler{
		messageUseCase: messageUseCase,
		hub:            hub,
		log:            log,
	}
}

type CreateMessageRequest struct {
	Content   string     `json:"content"`
	StickerID *uuid.UUID `json:"sticker_id"`
}

func (h *MessageHandler) CreateMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelIDStr := r.PathValue("channel_id")
	channelID, err := uuid.Parse(channelIDStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}

	var req CreateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	if req.Content == "" && req.StickerID == nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeMessageEmpty, "message content is required")
		return
	}
	if req.StickerID != nil && req.Content != "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerWithText, "sticker messages cannot contain text")
		return
	}

	msg, err := h.messageUseCase.CreateMessage(channelID, userID, req.Content, req.StickerID)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	// Broadcast to all clients currently viewing this channel
	payload, _ := json.Marshal(msg)
	h.hub.SendToChannel(channelID, &ws.Message{
		Type:    "chat_message",
		Payload: payload,
	})

	h.sendJSON(w, http.StatusCreated, msg)
}

func (h *MessageHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelIDStr := r.PathValue("channel_id")
	channelID, err := uuid.Parse(channelIDStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	if limit <= 0 {
		limit = 50
	}

	messages, err := h.messageUseCase.GetMessages(channelID, userID, limit, offset)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	if messages == nil {
		messages = []*domain.Message{}
	}

	h.sendJSON(w, http.StatusOK, messages)
}

type SearchMessagesResponse struct {
	Results []*domain.MessageWithAuthor `json:"results"`
	Total   int                         `json:"total"`
}

func (h *MessageHandler) SearchMessages(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if n := utf8.RuneCountInString(query); n < 2 || n > 100 {
		h.sendError(w, http.StatusBadRequest, httperr.CodeSearchQueryLength, "search query must be 2-100 characters")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		offset = 0
	}

	results, total, err := h.messageUseCase.SearchMessages(channelID, userID, query, limit, offset)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	if results == nil {
		results = []*domain.MessageWithAuthor{}
	}

	h.sendJSON(w, http.StatusOK, SearchMessagesResponse{Results: results, Total: total})
}

func (h *MessageHandler) GetMessagesAround(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	messageID, err := uuid.Parse(r.PathValue("message_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidMessageID, "invalid message id")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	messages, err := h.messageUseCase.GetMessagesAround(channelID, messageID, userID, limit)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	if messages == nil {
		messages = []*domain.Message{}
	}

	h.sendJSON(w, http.StatusOK, messages)
}

type UpdateMessageRequest struct {
	Content string `json:"content"`
}

func (h *MessageHandler) UpdateMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	messageID, err := uuid.Parse(r.PathValue("message_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidMessageID, "invalid message id")
		return
	}

	var req UpdateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	if req.Content == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeMessageEmpty, "message content is required")
		return
	}

	msg, err := h.messageUseCase.UpdateMessage(channelID, messageID, userID, req.Content)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(msg)
	h.hub.SendToChannel(channelID, &ws.Message{
		Type:    "message_update",
		Payload: payload,
	})

	h.sendJSON(w, http.StatusOK, msg)
}

type deleteMessagePayload struct {
	ID        uuid.UUID `json:"id"`
	ChannelID uuid.UUID `json:"channel_id"`
}

func (h *MessageHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	messageID, err := uuid.Parse(r.PathValue("message_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidMessageID, "invalid message id")
		return
	}

	if err := h.messageUseCase.DeleteMessage(channelID, messageID, userID); err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(deleteMessagePayload{ID: messageID, ChannelID: channelID})
	h.hub.SendToChannel(channelID, &ws.Message{
		Type:    "message_delete",
		Payload: payload,
	})

	w.WriteHeader(http.StatusNoContent)
}

// writeUseCaseError транслирует доменные ошибки в HTTP-статусы, не раскрывая
// внутренние детали (err.Error()) наружу.
func (h *MessageHandler) writeUseCaseError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrChannelNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeChannelNotFound, "channel not found")
	case errors.Is(err, domain.ErrMessageNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeMessageNotFound, "message not found")
	case errors.Is(err, domain.ErrStickerNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeStickerNotFound, "sticker not found")
	case errors.Is(err, domain.ErrInvalidMention):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidMention, "invalid mention: user is not a member of this server")
	case errors.Is(err, domain.ErrMentionForbidden):
		h.sendError(w, http.StatusForbidden, httperr.CodeMentionEveryoneDenied, "only server owner/admin can mention @everyone")
	case errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
	default:
		h.log.Error("message request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}

func (h *MessageHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *MessageHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
