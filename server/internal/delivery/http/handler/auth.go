package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"

	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

var (
	emailRegex    = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)
	usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]{3,30}$`)
)

type AuthHandler struct {
	authUseCase domain.AuthUseCase
	log         *slog.Logger
}

func NewAuthHandler(authUseCase domain.AuthUseCase, log *slog.Logger) *AuthHandler {
	return &AuthHandler{
		authUseCase: authUseCase,
		log:         log,
	}
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	AccessToken  string     `json:"access_token"`
	RefreshToken string     `json:"refresh_token"`
	User         meResponse `json:"user"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	if req.Email == "" || req.Password == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeCredentialsRequired, "email and password are required")
		return
	}

	user, accessToken, refreshToken, err := h.authUseCase.Login(req.Email, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidCredentials):
			h.sendError(w, http.StatusUnauthorized, httperr.CodeInvalidCredentials, err.Error())
		case errors.Is(err, domain.ErrEmailNotVerified):
			// 403, не 401: креды верны, но вход закрыт до подтверждения
			// почты. Код здесь не отправляется — см. комментарий в usecase.
			h.sendError(w, http.StatusForbidden, httperr.CodeEmailNotVerified, err.Error())
		default:
			h.sendError(w, http.StatusUnauthorized, httperr.CodeInternalError, err.Error())
		}
		return
	}

	h.sendJSON(w, http.StatusOK, LoginResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User: meResponse{
			User:                user,
			AllowFriendRequests: user.AllowFriendRequests,
			AllowDMFrom:         user.AllowDMFrom,
		},
	})
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type RefreshResponse struct {
	AccessToken  string     `json:"access_token"`
	RefreshToken string     `json:"refresh_token"`
	User         meResponse `json:"user"`
}

// Refresh обменивает refresh-токен на новую пару access+refresh. Не требует
// Authorization-заголовка: клиент вызывает его именно потому, что access-
// токен уже истёк.
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req RefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	user, accessToken, refreshToken, err := h.authUseCase.Refresh(req.RefreshToken)
	if err != nil {
		if errors.Is(err, domain.ErrRefreshTokenInvalid) {
			h.sendError(w, http.StatusUnauthorized, httperr.CodeInvalidToken, "invalid or expired refresh token")
		} else {
			h.log.Error("refresh failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
			h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "failed to refresh token")
		}
		return
	}

	h.sendJSON(w, http.StatusOK, RefreshResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		User: meResponse{
			User:                user,
			AllowFriendRequests: user.AllowFriendRequests,
			AllowDMFrom:         user.AllowDMFrom,
		},
	})
}

type LogoutRequest struct {
	RefreshToken string `json:"refresh_token"`
}

// Logout отзывает сессию, к которой принадлежит переданный refresh-токен.
// Всегда отвечает 204 — логаут идемпотентен и не должен требовать от
// клиента специальной обработки ошибок при выходе.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var req LogoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := h.authUseCase.Logout(req.RefreshToken); err != nil {
		h.log.Error("logout failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *AuthHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
