package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/domain"
)

type InviteHandler struct {
	inviteUseCase domain.InviteUseCase
	log           *slog.Logger
}

func NewInviteHandler(inviteUseCase domain.InviteUseCase, log *slog.Logger) *InviteHandler {
	return &InviteHandler{inviteUseCase: inviteUseCase, log: log}
}

func (h *InviteHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("server_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	invite, err := h.inviteUseCase.CreateInvite(serverID, userID)
	if err != nil {
		h.writeUseCaseError(w, err)
		return
	}
	h.sendJSON(w, http.StatusCreated, invite)
}

func (h *InviteHandler) ListInvites(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("server_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	invites, err := h.inviteUseCase.ListInvites(serverID, userID)
	if err != nil {
		h.writeUseCaseError(w, err)
		return
	}
	if invites == nil {
		invites = []*domain.Invite{}
	}
	h.sendJSON(w, http.StatusOK, invites)
}

func (h *InviteHandler) RevokeInvite(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("server_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}
	code := r.PathValue("code")

	if err := h.inviteUseCase.RevokeInvite(serverID, code, userID); err != nil {
		h.writeUseCaseError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *InviteHandler) PreviewInvite(w http.ResponseWriter, r *http.Request) {
	code := r.PathValue("code")

	preview, err := h.inviteUseCase.PreviewInvite(code)
	if err != nil {
		h.writeUseCaseError(w, err)
		return
	}
	h.sendJSON(w, http.StatusOK, preview)
}

func (h *InviteHandler) JoinViaInvite(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	code := r.PathValue("code")

	server, err := h.inviteUseCase.JoinViaInvite(code, userID)
	if err != nil {
		h.writeUseCaseError(w, err)
		return
	}
	h.sendJSON(w, http.StatusOK, server)
}

func (h *InviteHandler) writeUseCaseError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrInviteNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeInviteNotFound, "invite not found")
	case errors.Is(err, domain.ErrInviteForbidden):
		h.sendError(w, http.StatusForbidden, httperr.CodeInviteForbidden, "invite access denied")
	case errors.Is(err, domain.ErrServerNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeServerNotFound, "server not found")
	default:
		h.log.Error("invite request failed", "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}

func (h *InviteHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *InviteHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
