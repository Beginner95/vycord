package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type OnlineUsersHandler struct {
	hub      *ws.Hub
	userRepo domain.UserRepository
	log      *slog.Logger
}

func NewOnlineUsersHandler(hub *ws.Hub, userRepo domain.UserRepository, log *slog.Logger) *OnlineUsersHandler {
	return &OnlineUsersHandler{
		hub:      hub,
		userRepo: userRepo,
		log:      log,
	}
}

func (h *OnlineUsersHandler) GetOnlineUsers(w http.ResponseWriter, r *http.Request) {
	onlineIDs := h.hub.GetOnlineUsers()

	if len(onlineIDs) == 0 {
		h.sendJSON(w, http.StatusOK, []interface{}{})
		return
	}

	users := make([]*domain.User, 0, len(onlineIDs))
	for _, id := range onlineIDs {
		user, err := h.userRepo.GetByID(id)
		if err != nil {
			continue
		}
		user.Password = ""
		user.Status = domain.StatusOnline
		users = append(users, user)
	}

	h.sendJSON(w, http.StatusOK, users)
}

func (h *OnlineUsersHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
