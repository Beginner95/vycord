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

type RegisterRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	if req.Username == "" || req.Email == "" || req.Password == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeSignupFieldsMissing, "username, email and password are required")
		return
	}

	if !usernameRegex.MatchString(req.Username) {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidUsername, "username must be 3-30 characters, alphanumeric, underscore or hyphen only")
		return
	}

	if !emailRegex.MatchString(req.Email) {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidEmail, "invalid email format")
		return
	}

	if len(req.Password) < 8 {
		h.sendError(w, http.StatusBadRequest, httperr.CodePasswordTooShort, "password must be at least 8 characters")
		return
	}

	user, err := h.authUseCase.Register(req.Username, req.Email, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrEmailTaken):
			h.sendError(w, http.StatusConflict, httperr.CodeEmailTaken, err.Error())
		case errors.Is(err, domain.ErrUsernameTaken):
			h.sendError(w, http.StatusConflict, httperr.CodeUsernameTaken, err.Error())
		case errors.Is(err, domain.ErrMailSendFailed):
			h.sendError(w, http.StatusBadGateway, httperr.CodeMailSendFailed, "failed to send the code, try again")
		default:
			h.log.Error("register failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
			h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "failed to register")
		}
		return
	}

	// 202 и никаких токенов: сессия открывается только после ввода кода.
	h.sendJSON(w, http.StatusAccepted, map[string]interface{}{
		"status": "otp_sent",
		"user":   user,
	})
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	AccessToken  string       `json:"access_token"`
	RefreshToken string       `json:"refresh_token"`
	User         *domain.User `json:"user"`
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
		if errors.Is(err, domain.ErrInvalidCredentials) {
			h.sendError(w, http.StatusUnauthorized, httperr.CodeInvalidCredentials, err.Error())
		} else {
			h.sendError(w, http.StatusUnauthorized, httperr.CodeInternalError, err.Error())
		}
		return
	}

	h.sendJSON(w, http.StatusOK, LoginResponse{AccessToken: accessToken, RefreshToken: refreshToken, User: user})
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

type RefreshResponse struct {
	AccessToken  string       `json:"access_token"`
	RefreshToken string       `json:"refresh_token"`
	User         *domain.User `json:"user"`
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

	h.sendJSON(w, http.StatusOK, RefreshResponse{AccessToken: accessToken, RefreshToken: refreshToken, User: user})
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
