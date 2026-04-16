package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/google/uuid"
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
	Content string `json:"content"`
}

func (h *MessageHandler) CreateMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelIDStr := r.PathValue("channel_id")
	channelID, err := uuid.Parse(channelIDStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	var req CreateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Content == "" {
		h.sendError(w, http.StatusBadRequest, "message content is required")
		return
	}

	msg, err := h.messageUseCase.CreateMessage(channelID, userID, req.Content)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, err.Error())
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
	channelIDStr := r.PathValue("channel_id")
	channelID, err := uuid.Parse(channelIDStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	if limit <= 0 {
		limit = 50
	}

	messages, err := h.messageUseCase.GetMessages(channelID, limit, offset)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, "failed to get messages")
		return
	}

	if messages == nil {
		messages = []*domain.Message{}
	}

	h.sendJSON(w, http.StatusOK, messages)
}

func (h *MessageHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *MessageHandler) sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
