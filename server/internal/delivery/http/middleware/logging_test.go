package middleware

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestLogging_RecordsStatusMethodPath(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	handler := Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/123", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	out := buf.String()
	for _, want := range []string{"method=GET", "path=/api/v1/users/123", "status=404"} {
		if !strings.Contains(out, want) {
			t.Fatalf("expected log output to contain %q, got: %s", want, out)
		}
	}
}

func TestLogging_DefaultsToStatus200WhenWriteHeaderNotCalled(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	handler := Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !strings.Contains(buf.String(), "status=200") {
		t.Fatalf("expected status=200 in log output, got: %s", buf.String())
	}
}

func TestLogging_IncludesRequestIDFromContext(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	chain := RequestID(Logging(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	chain.ServeHTTP(rec, req)

	headerID := rec.Header().Get(RequestIDHeader)
	if headerID == "" {
		t.Fatal("expected X-Request-Id header to be set")
	}
	if !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected log output to contain request_id=%s, got: %s", headerID, buf.String())
	}
}

// TestLogging_AllowsWebSocketUpgrade is a regression test for a bug where
// statusRecorder (which embeds the http.ResponseWriter interface, not a
// concrete type) failed to promote Hijack(), so it did not satisfy
// http.Hijacker. gorilla/websocket's Upgrade requires the ResponseWriter to
// implement http.Hijacker in order to take over the raw TCP connection for
// the WebSocket handshake; without that, every upgrade through this
// middleware failed with an HTTP 500 ("response does not implement
// http.Hijacker"). This uses a real httptest.Server (not
// httptest.NewRecorder, which never supports hijacking) so the hijack path
// is genuinely exercised over a real network connection.
func TestLogging_AllowsWebSocketUpgrade(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	upgrader := websocket.Upgrader{}
	wsHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade failed: %v", err)
			return
		}
		defer conn.Close()
	})

	server := httptest.NewServer(Logging(log)(wsHandler))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v (status %v)", err, resp)
	}
	defer conn.Close()

	// gorilla/websocket hijacks the raw connection and writes the 101
	// response directly to it, bypassing statusRecorder.WriteHeader
	// entirely. So the recorder's status field never gets updated from its
	// initialized default (http.StatusOK), and the access log line
	// legitimately reports status=200 for what was actually a 101 Switching
	// Protocols response on the wire. This is an accepted, documented
	// limitation of status logging for hijacked connections, not a bug: the
	// point of this test is that the upgrade itself succeeds.
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("expected actual HTTP response status 101, got: %d", resp.StatusCode)
	}
	if !strings.Contains(buf.String(), "status=200") {
		t.Fatalf("expected logged status=200 (hijack bypasses WriteHeader), got: %s", buf.String())
	}
}
