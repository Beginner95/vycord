package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/vycord/server/internal/domain"
)

type AuthMiddleware struct {
	authUseCase domain.AuthUseCase
	log         *slog.Logger
}

func NewAuthMiddleware(authUseCase domain.AuthUseCase, log *slog.Logger) *AuthMiddleware {
	return &AuthMiddleware{
		authUseCase: authUseCase,
		log:         log,
	}
}

func (m *AuthMiddleware) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			m.sendError(w, http.StatusUnauthorized, "missing authorization header")
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenString == authHeader {
			m.sendError(w, http.StatusUnauthorized, "invalid authorization header format")
			return
		}

		user, err := m.authUseCase.ValidateToken(tokenString)
		if err != nil {
			m.sendError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}

		// Add user to context
		ctx := context.WithValue(r.Context(), "user_id", user.ID)
		ctx = context.WithValue(ctx, "user", user)

		next(w, r.WithContext(ctx))
	}
}

func (m *AuthMiddleware) sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"error":"` + message + `"}`))
}
