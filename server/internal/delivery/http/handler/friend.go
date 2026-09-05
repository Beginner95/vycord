package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type FriendHandler struct {
	friendUseCase domain.FriendUseCase
	hub           *ws.Hub
	log           *slog.Logger
}

func NewFriendHandler(friendUseCase domain.FriendUseCase, hub *ws.Hub, log *slog.Logger) *FriendHandler {
	return &FriendHandler{friendUseCase: friendUseCase, hub: hub, log: log}
}

func (h *FriendHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}

func (h *FriendHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// writeFriendError — единая трансляция доменных ошибок в HTTP. Существует
// затем, чтобы ErrInteractionForbidden гарантированно уходил ОДНИМ кодом:
// разложенный по хендлерам switch рано или поздно расщепил бы его на
// «заблокирован» и «закрыл приём», а это утечка.
func (h *FriendHandler) writeFriendError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrSelfFriendship):
		h.sendError(w, http.StatusBadRequest, httperr.CodeFriendSelf, "cannot befriend yourself")
	case errors.Is(err, domain.ErrFriendRequestExists):
		h.sendError(w, http.StatusConflict, httperr.CodeFriendRequestExists, "friend request already exists")
	case errors.Is(err, domain.ErrAlreadyFriends):
		h.sendError(w, http.StatusConflict, httperr.CodeAlreadyFriends, "already friends")
	case errors.Is(err, domain.ErrFriendshipNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeFriendshipNotFound, "friendship not found")
	case errors.Is(err, domain.ErrInteractionForbidden):
		// Ни слова о причине.
		h.sendError(w, http.StatusForbidden, httperr.CodeInteractionForbidden, "interaction not allowed")
	case errors.Is(err, domain.ErrUserNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeUserNotFound, "user not found")
	default:
		h.log.Error("friend operation failed",
			"request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal error")
	}
}

func (h *FriendHandler) ListFriends(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	friends, err := h.friendUseCase.ListFriends(userID)
	if err != nil {
		h.writeFriendError(w, r, err)
		return
	}
	h.sendJSON(w, http.StatusOK, map[string]any{"friends": friends})
}

func (h *FriendHandler) ListRequests(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	incoming, outgoing, err := h.friendUseCase.ListRequests(userID)
	if err != nil {
		h.writeFriendError(w, r, err)
		return
	}
	h.sendJSON(w, http.StatusOK, map[string]any{"incoming": incoming, "outgoing": outgoing})
}

func (h *FriendHandler) SendRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	var body struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	username := strings.TrimSpace(body.Username)
	if username == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeUsernameRequired, "username is required")
		return
	}

	req, target, accepted, err := h.friendUseCase.SendRequest(userID, username)
	if err != nil {
		h.writeFriendError(w, r, err)
		return
	}

	if accepted {
		// Встречная заявка стала дружбой — обе стороны узнают об этом сразу.
		h.notifyFriendAdded(userID, target)
		h.sendJSON(w, http.StatusOK, map[string]any{"status": "accepted", "user": target})
		return
	}

	h.hub.SendToUser(target.UserID, wsMessage("friend_request", req))
	h.sendJSON(w, http.StatusCreated, map[string]any{"status": "pending", "request": req})
}

func (h *FriendHandler) AcceptRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	requestID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUserID, "invalid request id")
		return
	}

	profile, _, err := h.friendUseCase.AcceptRequest(userID, requestID)
	if err != nil {
		h.writeFriendError(w, r, err)
		return
	}

	// Обе стороны узнают о новой дружбе сразу — как и во встречной ветке
	// SendRequest: у принявшего заявку тоже может быть открыта вторая
	// вкладка, которую HTTP-ответ этого запроса не обновит.
	h.notifyFriendAdded(userID, &profile.UserBrief)
	h.sendJSON(w, http.StatusOK, profile)
}

func (h *FriendHandler) DeleteRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	requestID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUserID, "invalid request id")
		return
	}

	otherID, err := h.friendUseCase.DeleteRequest(userID, requestID)
	if err != nil {
		h.writeFriendError(w, r, err)
		return
	}

	h.hub.SendToUser(otherID, wsMessage("friend_request_cancelled",
		map[string]any{"id": requestID.String()}))
	w.WriteHeader(http.StatusNoContent)
}

func (h *FriendHandler) RemoveFriend(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	friendID, err := uuid.Parse(r.PathValue("user_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUserID, "invalid user id")
		return
	}

	if err := h.friendUseCase.RemoveFriend(userID, friendID); err != nil {
		h.writeFriendError(w, r, err)
		return
	}

	h.hub.SendToUser(friendID, wsMessage("friend_removed", map[string]any{"user_id": userID.String()}))
	w.WriteHeader(http.StatusNoContent)
}

func (h *FriendHandler) ListBlocks(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	blocked, err := h.friendUseCase.ListBlocks(userID)
	if err != nil {
		h.writeFriendError(w, r, err)
		return
	}
	h.sendJSON(w, http.StatusOK, map[string]any{"blocked": blocked})
}

func (h *FriendHandler) Block(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	var body struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	targetID, err := uuid.Parse(body.UserID)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUserID, "invalid user id")
		return
	}

	if err := h.friendUseCase.Block(userID, targetID); err != nil {
		h.writeFriendError(w, r, err)
		return
	}

	// Блокировка удаляет дружбу — заблокированный обязан увидеть это в
	// своём списке, иначе у него останется «друг», которому нельзя писать.
	h.hub.SendToUser(targetID, wsMessage("friend_removed", map[string]any{"user_id": userID.String()}))
	w.WriteHeader(http.StatusNoContent)
}

func (h *FriendHandler) Unblock(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	targetID, err := uuid.Parse(r.PathValue("user_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUserID, "invalid user id")
		return
	}
	if err := h.friendUseCase.Unblock(userID, targetID); err != nil {
		h.writeFriendError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// notifyFriendAdded уведомляет обе стороны: тот, кто нажал кнопку, получит
// событие тоже — у него может быть открыто второе окно.
func (h *FriendHandler) notifyFriendAdded(actorID uuid.UUID, other *domain.UserBrief) {
	h.hub.SendToUser(other.UserID, wsMessage("friend_added", map[string]any{"user_id": actorID.String()}))
	h.hub.SendToUser(actorID, wsMessage("friend_added", map[string]any{"user_id": other.UserID.String()}))
}

// wsMessage собирает ws.Message с уже сериализованным payload.
func wsMessage(eventType string, payload any) *ws.Message {
	data, _ := json.Marshal(payload)
	return &ws.Message{Type: eventType, Payload: data}
}
