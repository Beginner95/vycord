package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type ServerHandler struct {
	serverUseCase domain.ServerUseCase
	log           *slog.Logger
}

func NewServerHandler(serverUseCase domain.ServerUseCase, log *slog.Logger) *ServerHandler {
	return &ServerHandler{
		serverUseCase: serverUseCase,
		log:           log,
	}
}

type CreateServerRequest struct {
	Name string `json:"name"`
}

func (h *ServerHandler) CreateServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	var req CreateServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		h.sendError(w, http.StatusBadRequest, "server name is required")
		return
	}

	server, err := h.serverUseCase.CreateServer(req.Name, userID)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.sendJSON(w, http.StatusCreated, server)
}

func (h *ServerHandler) GetServer(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	server, err := h.serverUseCase.GetServer(serverID)
	if err != nil {
		h.sendError(w, http.StatusNotFound, "server not found")
		return
	}

	h.sendJSON(w, http.StatusOK, server)
}

func (h *ServerHandler) GetUserServers(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	servers, err := h.serverUseCase.GetUserServers(userID)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, "failed to get servers")
		return
	}

	if servers == nil {
		servers = []*domain.Server{}
	}

	h.sendJSON(w, http.StatusOK, servers)
}

func (h *ServerHandler) JoinServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	if err := h.serverUseCase.JoinServer(serverID, userID); err != nil {
		h.sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *ServerHandler) LeaveServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	if err := h.serverUseCase.LeaveServer(serverID, userID); err != nil {
		h.sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type CreateChannelRequest struct {
	Name string        `json:"name"`
	Type domain.ChannelType `json:"type"`
}

func (h *ServerHandler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("server_id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	var req CreateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		h.sendError(w, http.StatusBadRequest, "channel name is required")
		return
	}

	if req.Type == "" {
		req.Type = domain.ChannelTypeText
	}

	channel, err := h.serverUseCase.CreateChannel(serverID, req.Name, req.Type)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.sendJSON(w, http.StatusCreated, channel)
}

func (h *ServerHandler) GetChannels(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("server_id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	channels, err := h.serverUseCase.GetChannels(serverID)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, "failed to get channels")
		return
	}

	if channels == nil {
		channels = []*domain.Channel{}
	}

	h.sendJSON(w, http.StatusOK, channels)
}

func (h *ServerHandler) GetMembers(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("server_id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	members, err := h.serverUseCase.GetMembers(serverID, userID)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			h.sendError(w, http.StatusForbidden, "access denied")
			return
		}
		h.sendError(w, http.StatusInternalServerError, "failed to get members")
		return
	}

	if members == nil {
		members = []*domain.MemberWithUser{}
	}

	h.sendJSON(w, http.StatusOK, members)
}

func (h *ServerHandler) SearchServers(w http.ResponseWriter, r *http.Request) {
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

	servers, err := h.serverUseCase.SearchServers(query, limit)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, "failed to search servers")
		return
	}

	if servers == nil {
		servers = []*domain.Server{}
	}

	h.sendJSON(w, http.StatusOK, servers)
}

func (h *ServerHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *ServerHandler) sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
