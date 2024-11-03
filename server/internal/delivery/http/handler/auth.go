package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/vycord/server/internal/domain"
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
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Username == "" || req.Email == "" || req.Password == "" {
		h.sendError(w, http.StatusBadRequest, "username, email and password are required")
		return
	}

	if len(req.Password) < 6 {
		h.sendError(w, http.StatusBadRequest, "password must be at least 6 characters")
		return
	}

	user, token, err := h.authUseCase.Register(req.Username, req.Email, req.Password)
	if err != nil {
		h.sendError(w, http.StatusConflict, err.Error())
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
	Token string         `json:"token"`
	User  *domain.User   `json:"user"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Email == "" || req.Password == "" {
		h.sendError(w, http.StatusBadRequest, "email and password are required")
		return
	}

	user, token, err := h.authUseCase.Login(req.Email, req.Password)
	if err != nil {
		h.sendError(w, http.StatusUnauthorized, err.Error())
		return
	}

	h.sendJSON(w, http.StatusOK, LoginResponse{Token: token, User: user})
}

func (h *AuthHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *AuthHandler) sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
