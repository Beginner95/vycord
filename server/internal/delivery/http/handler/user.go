package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

type UserHandler struct {
	userUseCase domain.UserUseCase
	log         *slog.Logger
}

func NewUserHandler(userUseCase domain.UserUseCase, log *slog.Logger) *UserHandler {
	return &UserHandler{
		userUseCase: userUseCase,
		log:         log,
	}
}

func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	user, err := h.userUseCase.GetByID(userID)
	if err != nil {
		h.sendError(w, http.StatusNotFound, "user not found")
		return
	}

	h.sendJSON(w, http.StatusOK, user)
}

func (h *UserHandler) GetUserByID(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	user, err := h.userUseCase.GetByID(userID)
	if err != nil {
		h.sendError(w, http.StatusNotFound, "user not found")
		return
	}

	h.sendJSON(w, http.StatusOK, user)
}

func (h *UserHandler) UpdateLastVisited(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	var req struct {
		ServerID  *string `json:"server_id"`
		ChannelID *string `json:"channel_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var serverID, channelID *uuid.UUID
	if req.ServerID != nil {
		id, err := uuid.Parse(*req.ServerID)
		if err != nil {
			h.sendError(w, http.StatusBadRequest, "invalid server_id")
			return
		}
		serverID = &id
	}
	if req.ChannelID != nil {
		id, err := uuid.Parse(*req.ChannelID)
		if err != nil {
			h.sendError(w, http.StatusBadRequest, "invalid channel_id")
			return
		}
		channelID = &id
	}

	if err := h.userUseCase.UpdateLastVisited(userID, serverID, channelID); err != nil {
		h.log.Error("failed to update last visited", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, "failed to update last visited")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		h.sendError(w, http.StatusBadRequest, "query parameter 'q' is required")
		return
	}

	limit := 20
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if _, err := fmt.Sscanf(limitStr, "%d", &limit); err != nil {
			limit = 20
		}
	}

	users, err := h.userUseCase.Search(query, limit)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, "failed to search users")
		return
	}

	h.sendJSON(w, http.StatusOK, users)
}

func (h *UserHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *UserHandler) sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
