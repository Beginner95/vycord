package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

// CallHandler — HTTP-часть звонков 1:1: room-токен SFU. Сигналинг вызова
// идёт по WS (websocket.go), здесь только то, что нужно до входа в комнату.
type CallHandler struct {
	calls domain.CallUseCase
	log   *slog.Logger
}

func NewCallHandler(calls domain.CallUseCase, log *slog.Logger) *CallHandler {
	return &CallHandler{calls: calls, log: log}
}

// IssueVoiceToken — room-токен для комнаты SFU звонка (room_id = call_id).
// Только участнику и только в статусе active.
func (h *CallHandler) IssueVoiceToken(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	callID, err := uuid.Parse(r.PathValue("call_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidCallID, "invalid call id")
		return
	}
	token, err := h.calls.IssueRoomToken(userID, callID)
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(voiceTokenResponse{Token: token})
	case errors.Is(err, domain.ErrCallNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeCallNotFound, "call not found")
	case errors.Is(err, domain.ErrCallInvalidState):
		h.sendError(w, http.StatusConflict, httperr.CodeCallNotActive, "call is not active")
	default:
		h.log.Error("call voice token failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeVoiceTokenFailed, "failed to issue voice token")
	}
}

// sendError — тот же формат ответа, что у токена канала: делегируем
// VoiceTokenHandler.sendError, чтобы ошибки двух эндпоинтов не разошлись.
func (h *CallHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	(&VoiceTokenHandler{log: h.log}).sendError(w, status, code, message)
}
