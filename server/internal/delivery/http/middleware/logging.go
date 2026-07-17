package middleware

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"
)

// statusRecorder wraps http.ResponseWriter to capture the status code
// written by the wrapped handler, so Logging can include it after the
// handler has already returned.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

// Hijack forwards to the underlying ResponseWriter's Hijacker implementation
// if it has one. Without this, statusRecorder only promotes the methods of
// the embedded http.ResponseWriter interface (Header, Write, WriteHeader),
// so it would NOT satisfy http.Hijacker even though the real underlying
// net/http ResponseWriter does. That would break any handler that needs to
// hijack the connection, most importantly WebSocket upgrades performed by
// gorilla/websocket, which type-asserts the ResponseWriter to http.Hijacker
// and fails the upgrade with an explicit 500 error if the assertion fails.
func (w *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("statusRecorder: underlying ResponseWriter does not implement http.Hijacker")
	}
	return hj.Hijack()
}

// Logging returns middleware that writes one structured log line per
// request, tagged with the request ID set by RequestID (empty if that
// middleware isn't wired in, e.g. in isolated tests).
func Logging(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			log.Info("http request",
				"request_id", RequestIDFromContext(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}
