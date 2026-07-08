package signaling

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/vycord/server/internal/sfu/application"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

const testSecret = "handler-test-secret"

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory([]string{}, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	mgr := application.NewRoomManager(pf, log)
	t.Cleanup(mgr.Shutdown)
	srv := httptest.NewServer(NewHandler(mgr, log, testSecret))
	t.Cleanup(srv.Close)
	return srv
}

func signToken(t *testing.T, userID string, exp time.Time) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"user_id": userID,
		"exp":     exp.Unix(),
	})
	s, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return s
}

// dialStatus attempts a WebSocket handshake and returns the HTTP status of
// the response (101 on a successful upgrade).
func dialStatus(t *testing.T, srv *httptest.Server, query string) int {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?" + query
	conn, resp, err := websocket.DefaultDialer.Dial(url, nil)
	if err == nil {
		conn.Close()
	}
	if resp == nil {
		t.Fatalf("dial returned no HTTP response: %v", err)
	}
	return resp.StatusCode
}

func TestServeHTTPRejectsMissingToken(t *testing.T) {
	srv := newTestServer(t)
	if got := dialStatus(t, srv, "room_id=r1"); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

func TestServeHTTPRejectsMissingRoomID(t *testing.T) {
	srv := newTestServer(t)
	tok := signToken(t, uuid.NewString(), time.Now().Add(time.Hour))
	if got := dialStatus(t, srv, "token="+tok); got != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", got)
	}
}

func TestServeHTTPRejectsGarbageToken(t *testing.T) {
	srv := newTestServer(t)
	if got := dialStatus(t, srv, "room_id=r1&token=garbage"); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

func TestServeHTTPRejectsExpiredToken(t *testing.T) {
	srv := newTestServer(t)
	tok := signToken(t, uuid.NewString(), time.Now().Add(-time.Hour))
	if got := dialStatus(t, srv, "room_id=r1&token="+tok); got != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

func TestServeHTTPAcceptsValidTokenAndJoins(t *testing.T) {
	srv := newTestServer(t)
	tok := signToken(t, uuid.NewString(), time.Now().Add(time.Hour))
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?room_id=r1&token=" + tok

	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial with valid token: %v", err)
	}
	defer conn.Close()

	// The server pushes "joined" right after the join; an "offer" may arrive
	// around it, so read until "joined" shows up.
	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			t.Fatalf("waiting for joined: %v", err)
		}
		if msg.Type == "joined" {
			return
		}
	}
}
