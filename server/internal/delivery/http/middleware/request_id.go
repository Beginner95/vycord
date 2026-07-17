package middleware

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

type contextKey int

const requestIDKey contextKey = iota

// RequestIDHeader is the response header carrying the per-request trace ID.
const RequestIDHeader = "X-Request-Id"

// RequestID generates a UUID for every incoming request, exposes it via the
// X-Request-Id response header, and makes it available to downstream
// handlers through the request context.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.New().String()
		w.Header().Set(RequestIDHeader, id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestIDFromContext returns the request ID stored by RequestID, or an
// empty string if none is present (e.g. in tests that call a handler
// directly without wiring the middleware).
func RequestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}
