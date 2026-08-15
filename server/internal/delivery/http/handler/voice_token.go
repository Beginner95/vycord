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

type VoiceTokenHandler struct {
	voiceTokenUseCase domain.VoiceTokenUseCase
	log               *slog.Logger
}

func NewVoiceTokenHandler(voiceTokenUseCase domain.VoiceTokenUseCase, log *slog.Logger) *VoiceTokenHandler {
	return &VoiceTokenHandler{voiceTokenUseCase: voiceTokenUseCase, log: log}
}

type voiceTokenResponse struct {
	Token string `json:"token"`
}

// IssueToken mints a short-lived, room-scoped token the client uses to
// authenticate its WebSocket connection to the SFU for channelID's voice
// room. See docs/superpowers/specs/2026-08-04-private-channels-design.md.
func (h *VoiceTokenHandler) IssueToken(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}

	token, err := h.voiceTokenUseCase.IssueToken(channelID, userID)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrChannelNotFound):
			h.sendError(w, http.StatusNotFound, httperr.CodeChannelNotFound, "channel not found")
		case errors.Is(err, domain.ErrChannelForbidden), errors.Is(err, domain.ErrForbidden):
			h.sendError(w, http.StatusForbidden, httperr.CodeChannelForbidden, "channel access denied")
		default:
			h.log.Error("voice token request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
			h.sendError(w, http.StatusInternalServerError, httperr.CodeVoiceTokenFailed, "failed to issue voice token")
		}
		return
	}

	h.sendJSON(w, http.StatusOK, voiceTokenResponse{Token: token})
}

func (h *VoiceTokenHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *VoiceTokenHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
