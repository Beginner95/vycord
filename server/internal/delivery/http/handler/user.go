package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

const (
	// maxAvatarRequestBytes caps the raw multipart request body — a bit
	// above maxAvatarFileBytes to leave room for multipart boundaries/headers.
	maxAvatarRequestBytes = 3 << 20
	// maxAvatarFileBytes is the spec limit on the actual avatar file content.
	maxAvatarFileBytes = 2 << 20
	// maxLastSeenBatchRequestBytes caps the raw body of POST
	// /api/v1/users/last-seen — generous for a list of UUID strings (16KB is
	// roughly 400+ UUIDs at ~38 bytes each including JSON quoting/commas),
	// but stops an authenticated client from forcing a large allocation via
	// json.Decode before the 200-item cap is even checked.
	maxLastSeenBatchRequestBytes = 16 << 10
)

type UserHandler struct {
	userUseCase domain.UserUseCase
	hub         *ws.Hub
	log         *slog.Logger
}

func NewUserHandler(userUseCase domain.UserUseCase, hub *ws.Hub, log *slog.Logger) *UserHandler {
	return &UserHandler{
		userUseCase: userUseCase,
		hub:         hub,
		log:         log,
	}
}

// meResponse re-exposes AllowFriendRequests/AllowDMFrom with real JSON tags.
// domain.User tags these json:"-" (see its comment) so that GetUserByID and
// SearchUsers, which serialize domain.User directly, never leak another
// user's privacy settings. GetMe is the ONE legitimate place to show them —
// you're looking at your own profile — so the outer struct's shallower,
// explicitly-tagged fields win over the embedded *domain.User's json:"-"
// fields of the same name.
type meResponse struct {
	*domain.User
	AllowFriendRequests domain.PrivacyMode `json:"allow_friend_requests"`
	AllowDMFrom         domain.PrivacyMode `json:"allow_dm_from"`
}

func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	user, err := h.userUseCase.GetByID(userID)
	if err != nil {
		h.sendError(w, http.StatusNotFound, httperr.CodeUserNotFound, "user not found")
		return
	}

	h.sendJSON(w, http.StatusOK, meResponse{
		User:                user,
		AllowFriendRequests: user.AllowFriendRequests,
		AllowDMFrom:         user.AllowDMFrom,
	})
}

func (h *UserHandler) GetUserByID(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUserID, "invalid user id")
		return
	}

	user, err := h.userUseCase.GetByID(userID)
	if err != nil {
		h.sendError(w, http.StatusNotFound, httperr.CodeUserNotFound, "user not found")
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
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	var serverID, channelID *uuid.UUID
	if req.ServerID != nil {
		id, err := uuid.Parse(*req.ServerID)
		if err != nil {
			h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server_id")
			return
		}
		serverID = &id
	}
	if req.ChannelID != nil {
		id, err := uuid.Parse(*req.ChannelID)
		if err != nil {
			h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel_id")
			return
		}
		channelID = &id
	}

	if err := h.userUseCase.UpdateLastVisited(userID, serverID, channelID); err != nil {
		h.log.Error("failed to update last visited", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeLastVisitedFailed, "failed to update last visited")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeSearchQueryRequired, "query parameter 'q' is required")
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
		h.sendError(w, http.StatusInternalServerError, httperr.CodeSearchUsersFailed, "failed to search users")
		return
	}

	h.sendJSON(w, http.StatusOK, users)
}

func (h *UserHandler) GetLastSeenBatch(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxLastSeenBatchRequestBytes)

	var req struct {
		UserIDs []string `json:"user_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	if len(req.UserIDs) == 0 {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "user_ids required")
		return
	}
	ids := make([]uuid.UUID, 0, len(req.UserIDs))
	for _, s := range req.UserIDs {
		id, err := uuid.Parse(s)
		if err != nil {
			h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUserID, "invalid user id in user_ids")
			return
		}
		ids = append(ids, id)
	}

	result, err := h.userUseCase.GetLastSeenBatch(ids)
	if err != nil {
		if errors.Is(err, domain.ErrLastSeenBatchTooLarge) {
			h.sendError(w, http.StatusBadRequest, httperr.CodeLastSeenBatchTooLarge, "too many user_ids")
			return
		}
		h.log.Error("failed to get last seen batch", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeLastSeenFailed, "failed to get last seen")
		return
	}

	resp := make(map[string]map[string]interface{}, len(result))
	for id, info := range result {
		resp[id.String()] = map[string]interface{}{
			"last_seen_at": info.LastSeenAt,
			"visible":      info.Visible,
		}
	}
	h.sendJSON(w, http.StatusOK, resp)
}

func (h *UserHandler) UpdatePrivacy(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	var req struct {
		ShowLastSeen        *bool               `json:"show_last_seen"`
		AllowFriendRequests *domain.PrivacyMode `json:"allow_friend_requests"`
		AllowDMFrom         *domain.PrivacyMode `json:"allow_dm_from"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	// Тело без единого поля — не «ничего не менять», а ошибка клиента.
	if req.ShowLastSeen == nil && req.AllowFriendRequests == nil && req.AllowDMFrom == nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "no privacy fields provided")
		return
	}
	// Валидируем режимы до вызова use case: неизвестное значение не должно
	// доходить до бизнес-логики — тот же контракт, что и ValidForFriendRequests/
	// ValidForDM в usecase.userUseCase.SetPrivacy, но проверенный на входе.
	if req.AllowFriendRequests != nil && !req.AllowFriendRequests.ValidForFriendRequests() {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidPrivacyValue, "invalid privacy value")
		return
	}
	if req.AllowDMFrom != nil && !req.AllowDMFrom.ValidForDM() {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidPrivacyValue, "invalid privacy value")
		return
	}

	err := h.userUseCase.SetPrivacy(userID, req.ShowLastSeen, req.AllowFriendRequests, req.AllowDMFrom)
	if errors.Is(err, domain.ErrInvalidPrivacyMode) {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidPrivacyValue, "invalid privacy value")
		return
	}
	if err != nil {
		h.log.Error("failed to update privacy", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeLastSeenFailed, "failed to update privacy")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// UploadAvatar accepts a multipart/form-data request with a single "avatar"
// field (PNG or JPEG, ≤2MB), stores it, updates the user's avatar_url, and
// broadcasts the change to all connected clients over WebSocket.
func (h *UserHandler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarRequestBytes)
	if err := r.ParseMultipartForm(maxAvatarRequestBytes); err != nil {
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeAvatarTooLarge, "avatar file is too large")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, _, err := r.FormFile("avatar")
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeAvatarRequired, "avatar file is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxAvatarFileBytes+1))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeAvatarReadFailed, "failed to read avatar file")
		return
	}
	if len(data) > maxAvatarFileBytes {
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeAvatarTooLarge, "avatar file is too large")
		return
	}

	user, err := h.userUseCase.UpdateAvatar(userID, data)
	if err != nil {
		h.writeUserError(w, r, err)
		return
	}

	h.hub.BroadcastUserUpdate(userID, user.AvatarURL)
	h.sendJSON(w, http.StatusOK, meResponse{
		User:                user,
		AllowFriendRequests: user.AllowFriendRequests,
		AllowDMFrom:         user.AllowDMFrom,
	})
}

// RemoveAvatar clears the caller's avatar and broadcasts the change.
func (h *UserHandler) RemoveAvatar(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	user, err := h.userUseCase.RemoveAvatar(userID)
	if err != nil {
		h.writeUserError(w, r, err)
		return
	}

	h.hub.BroadcastUserUpdate(userID, user.AvatarURL)
	h.sendJSON(w, http.StatusOK, meResponse{
		User:                user,
		AllowFriendRequests: user.AllowFriendRequests,
		AllowDMFrom:         user.AllowDMFrom,
	})
}

func (h *UserHandler) writeUserError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrUnsupportedAvatarFormat):
		h.sendError(w, http.StatusBadRequest, httperr.CodeUnsupportedImageType, "unsupported format: only PNG, JPEG and GIF are allowed")
	case errors.Is(err, domain.ErrInvalidAvatarImage):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidImage, "invalid image file")
	case errors.Is(err, domain.ErrInvalidAvatarDimensions):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidImageSize, "image dimensions are out of allowed range")
	default:
		h.log.Error("user avatar request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeAvatarUpdateFailed, "failed to update avatar")
	}
}

func (h *UserHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *UserHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
