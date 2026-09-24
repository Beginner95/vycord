package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/guestws"
	"github.com/vycord/server/internal/domain"
)

type recordingRealtime struct {
	mu      sync.Mutex
	relayed []string
}

func (r *recordingRealtime) RelayGuestSignal(_ *domain.GuestContext, msgType string, _ json.RawMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.relayed = append(r.relayed, msgType)
}
func (r *recordingRealtime) Participants(uuid.UUID) *guestws.Message {
	return guestws.Marshal("participants", nil)
}
func (r *recordingRealtime) types() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.relayed...)
}

func newGuestWSServer(t *testing.T, guest *domain.GuestContext, authErr error) (*httptest.Server, *guestws.Gateway, *recordingRealtime) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := &mockGuestUseCase{}
	uc.On("Authenticate", "good").Return(guest, authErr)
	uc.On("Authenticate", "bad").Return(nil, domain.ErrGuestSessionInvalid)

	gw := guestws.NewGateway(log)
	rt := &recordingRealtime{}
	h := NewGuestWSHandler(uc, gw, rt, log)
	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	t.Cleanup(srv.Close)
	return srv, gw, rt
}

func dialGuestWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func sendFrame(t *testing.T, conn *websocket.Conn, msgType string, payload any) {
	t.Helper()
	raw, err := json.Marshal(guestws.Marshal(msgType, payload))
	require.NoError(t, err)
	require.NoError(t, conn.WriteMessage(websocket.TextMessage, raw))
}

func readFrame(t *testing.T, conn *websocket.Conn) guestws.Message {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(3*time.Second)))
	_, raw, err := conn.ReadMessage()
	require.NoError(t, err)
	var m guestws.Message
	require.NoError(t, json.Unmarshal(raw, &m))
	return m
}

func admittedCtx(channelID uuid.UUID) *domain.GuestContext {
	admitted := time.Now()
	return &domain.GuestContext{
		Guest: domain.CallGuest{
			ID: uuid.New(), ChannelID: channelID, DisplayName: "Гость",
			Status: domain.GuestStatusAdmitted, AdmittedAt: &admitted,
		},
		GuestLinksEnabled: true,
	}
}

func TestGuestWS_AdmittedGuestGetsRoster(t *testing.T) {
	channelID := uuid.New()
	gc := admittedCtx(channelID)
	srv, gw, _ := newGuestWSServer(t, gc, nil)

	conn := dialGuestWS(t, srv)
	sendFrame(t, conn, "auth", map[string]string{"token": "good"})

	assert.Equal(t, "admitted", readFrame(t, conn).Type)
	assert.Equal(t, "participants", readFrame(t, conn).Type)
	assert.Eventually(t, func() bool { return len(gw.Connected()) == 1 }, time.Second, 10*time.Millisecond)
}

func TestGuestWS_LobbyGuestWaits(t *testing.T) {
	gc := admittedCtx(uuid.New())
	gc.Guest.Status = domain.GuestStatusLobby
	gc.Guest.AdmittedAt = nil
	srv, _, _ := newGuestWSServer(t, gc, nil)

	conn := dialGuestWS(t, srv)
	sendFrame(t, conn, "auth", map[string]string{"token": "good"})
	assert.Equal(t, "lobby_waiting", readFrame(t, conn).Type)
}

func TestGuestWS_RejectsBadToken(t *testing.T) {
	srv, gw, _ := newGuestWSServer(t, nil, nil)
	conn := dialGuestWS(t, srv)
	sendFrame(t, conn, "auth", map[string]string{"token": "bad"})

	// Клиент должен отличить мёртвую сессию от обрыва: иначе он
	// переподключается к ней бесконечно.
	assert.Equal(t, "session_invalid", readFrame(t, conn).Type)

	require.NoError(t, conn.SetReadDeadline(time.Now().Add(3*time.Second)))
	_, _, err := conn.ReadMessage()
	assert.Error(t, err, "the socket closes instead of serving an unauthenticated guest")
	assert.Empty(t, gw.Connected())
}

func TestGuestWS_TransientAuthFailureIsNotSessionInvalid(t *testing.T) {
	srv, gw, _ := newGuestWSServer(t, nil, errors.New("db is down"))
	conn := dialGuestWS(t, srv)
	sendFrame(t, conn, "auth", map[string]string{"token": "good"})

	// Сбой БД — не приговор сессии: сокет просто закрывается, и клиент
	// переподключится.
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(3*time.Second)))
	_, _, err := conn.ReadMessage()
	assert.Error(t, err)
	assert.Empty(t, gw.Connected())
}

func TestGuestWS_RequiresAuthFrameFirst(t *testing.T) {
	srv, gw, rt := newGuestWSServer(t, admittedCtx(uuid.New()), nil)
	conn := dialGuestWS(t, srv)
	sendFrame(t, conn, "mic_muted", nil)

	require.NoError(t, conn.SetReadDeadline(time.Now().Add(3*time.Second)))
	_, _, err := conn.ReadMessage()
	assert.Error(t, err)
	assert.Empty(t, gw.Connected())
	assert.Empty(t, rt.types(), "nothing is relayed before authentication")
}

func TestGuestWS_RelaysOnlyAllowedTypes(t *testing.T) {
	gc := admittedCtx(uuid.New())
	srv, _, rt := newGuestWSServer(t, gc, nil)
	conn := dialGuestWS(t, srv)
	sendFrame(t, conn, "auth", map[string]string{"token": "good"})
	readFrame(t, conn) // admitted
	readFrame(t, conn) // participants

	sendFrame(t, conn, "mic_muted", nil)
	sendFrame(t, conn, "camera_off", nil)
	sendFrame(t, conn, "camera_on", nil)
	sendFrame(t, conn, "connection_quality", map[string]string{"level": "good"})
	sendFrame(t, conn, "join_channel", map[string]string{"channel_id": uuid.NewString()})
	sendFrame(t, conn, "ping", nil)

	assert.Equal(t, "pong", readFrame(t, conn).Type)
	assert.Equal(t, []string{"mic_muted", "camera_off", "camera_on", "connection_quality"}, rt.types(),
		"only the guest's own media signals are relayed; hub message types are ignored")
}
