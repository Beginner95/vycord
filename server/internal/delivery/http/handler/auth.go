package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"

	"github.com/vycord/server/internal/delivery/http/httperr"
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

	user, token, err := h.authUseCase.Register(req.Username, req.Email, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrEmailTaken):
			h.sendError(w, http.StatusConflict, httperr.CodeEmailTaken, err.Error())
		case errors.Is(err, domain.ErrUsernameTaken):
			h.sendError(w, http.StatusConflict, httperr.CodeUsernameTaken, err.Error())
		default:
			h.sendError(w, http.StatusConflict, httperr.CodeInternalError, err.Error())
		}
		return
	}

	h.sendJSON(w, http.StatusCreated, map[string]interface{}{
		"token": token,
		"user":  user,
	})
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type LoginResponse struct {
	Token string       `json:"token"`
	User  *domain.User `json:"user"`
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

	user, token, err := h.authUseCase.Login(req.Email, req.Password)
	if err != nil {
		if errors.Is(err, domain.ErrInvalidCredentials) {
			h.sendError(w, http.StatusUnauthorized, httperr.CodeInvalidCredentials, err.Error())
		} else {
			h.sendError(w, http.StatusUnauthorized, httperr.CodeInternalError, err.Error())
		}
		return
	}

	h.sendJSON(w, http.StatusOK, LoginResponse{Token: token, User: user})
}

func (h *AuthHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *AuthHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
