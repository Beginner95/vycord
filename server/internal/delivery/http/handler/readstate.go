package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// ChannelReadSender — то, что хендлеру нужно от хаба. *ws.Hub подходит как есть.
type ChannelReadSender interface {
	SendToChannelExcept(channelID, exceptUserID uuid.UUID, message *ws.Message)
}

// ReadStateHandler — курсоры прочтения, счётчики и квитанции (VYC-104).
type ReadStateHandler struct {
	uc  domain.ReadStateUseCase
	hub ChannelReadSender
	log *slog.Logger
}

func NewReadStateHandler(uc domain.ReadStateUseCase, hub ChannelReadSender, log *slog.Logger) *ReadStateHandler {
	return &ReadStateHandler{uc: uc, hub: hub, log: log}
}

type markReadRequest struct {
	MessageID uuid.UUID `json:"message_id"`
}

// channelReadPayload — WS channel_read. Кто именно прочитал, не сообщается:
// клиенту галочек нужно только «докуда дочитал хоть кто-то».
type channelReadPayload struct {
	ChannelID uuid.UUID  `json:"channel_id"`
	ReadAt    time.Time  `json:"read_at"`
	MessageID *uuid.UUID `json:"message_id"`
}

type readReceiptsResponse struct {
	OthersMaxReadAt        *time.Time `json:"others_max_read_at"`
	OthersMaxReadMessageID *uuid.UUID `json:"others_max_read_message_id"`
}

func (h *ReadStateHandler) GetUnread(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	list, err := h.uc.Unread(userID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if list == nil {
		list = []*domain.ChannelUnread{}
	}
	writeReadStateJSON(w, http.StatusOK, list)
}

func (h *ReadStateHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	var req markReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	if req.MessageID == uuid.Nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidMessageID, "invalid message id")
		return
	}

	res, err := h.uc.MarkRead(userID, channelID, req.MessageID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if res.Advanced {
		payload, _ := json.Marshal(channelReadPayload{ChannelID: channelID, ReadAt: res.At, MessageID: res.MessageID})
		h.hub.SendToChannelExcept(channelID, userID, &ws.Message{Type: "channel_read", Payload: payload})
	}
	writeReadStateJSON(w, http.StatusOK, res)
}

func (h *ReadStateHandler) GetReadReceipts(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		httperr.Write(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}
	cur, err := h.uc.OthersRead(userID, channelID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	var resp readReceiptsResponse
	if cur != nil {
		resp.OthersMaxReadAt = &cur.At
		resp.OthersMaxReadMessageID = cur.MessageID
	}
	writeReadStateJSON(w, http.StatusOK, resp)
}

func (h *ReadStateHandler) GetReaders(w http.ResponseWriter, r *http.Request) {
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
	res, err := h.uc.Readers(userID, channelID, messageID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	writeReadStateJSON(w, http.StatusOK, res)
}

func (h *ReadStateHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrChannelNotFound):
		httperr.Write(w, http.StatusNotFound, httperr.CodeChannelNotFound, "channel not found")
	case errors.Is(err, domain.ErrMessageNotFound):
		httperr.Write(w, http.StatusNotFound, httperr.CodeMessageNotFound, "message not found")
	case errors.Is(err, domain.ErrForbidden):
		httperr.Write(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
	default:
		h.log.Error("read state request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		httperr.Write(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}

func writeReadStateJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
