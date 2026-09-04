package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	ws "github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// --- Моки usecase'ов ---

type mockAuthUseCase struct{ mock.Mock }

func (m *mockAuthUseCase) Login(email, password string) (*domain.User, string, string, error) {
	args := m.Called(email, password)
	u, _ := args.Get(0).(*domain.User)
	return u, args.String(1), args.String(2), args.Error(3)
}
func (m *mockAuthUseCase) ValidateToken(tokenString string) (*domain.User, error) {
	args := m.Called(tokenString)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}
func (m *mockAuthUseCase) Refresh(refreshToken string) (*domain.User, string, string, error) {
	args := m.Called(refreshToken)
	u, _ := args.Get(0).(*domain.User)
	return u, args.String(1), args.String(2), args.Error(3)
}
func (m *mockAuthUseCase) Logout(refreshToken string) error {
	args := m.Called(refreshToken)
	return args.Error(0)
}

type mockUserUseCase struct{ mock.Mock }

func (m *mockUserUseCase) GetByID(id uuid.UUID) (*domain.User, error) {
	args := m.Called(id)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}
func (m *mockUserUseCase) Search(query string, limit int) ([]*domain.User, error) {
	args := m.Called(query, limit)
	u, _ := args.Get(0).([]*domain.User)
	return u, args.Error(1)
}
func (m *mockUserUseCase) UpdateStatus(id uuid.UUID, status domain.UserStatus) error {
	return m.Called(id, status).Error(0)
}
func (m *mockUserUseCase) GetOnlineUserIDs() []uuid.UUID {
	args := m.Called()
	ids, _ := args.Get(0).([]uuid.UUID)
	return ids
}
func (m *mockUserUseCase) UpdateLastVisited(id uuid.UUID, serverID, channelID *uuid.UUID) error {
	return m.Called(id, serverID, channelID).Error(0)
}

func (m *mockUserUseCase) UpdateAvatar(id uuid.UUID, data []byte) (*domain.User, error) {
	args := m.Called(id, data)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}

func (m *mockUserUseCase) RemoveAvatar(id uuid.UUID) (*domain.User, error) {
	args := m.Called(id)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}

func (m *mockUserUseCase) UpdateLastSeen(id uuid.UUID, at time.Time) error {
	return m.Called(id, at).Error(0)
}

func (m *mockUserUseCase) GetLastSeenBatch(ids []uuid.UUID) (map[uuid.UUID]domain.LastSeenInfo, error) {
	args := m.Called(ids)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(map[uuid.UUID]domain.LastSeenInfo), args.Error(1)
}

func (m *mockUserUseCase) SetPrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *domain.PrivacyMode) error {
	return m.Called(id, showLastSeen, friendRequests, dmFrom).Error(0)
}

type mockCallUseCase struct{ mock.Mock }

func (m *mockCallUseCase) StartCall(callerID, receiverID uuid.UUID) (*domain.Call, error) {
	args := m.Called(callerID, receiverID)
	c, _ := args.Get(0).(*domain.Call)
	return c, args.Error(1)
}
func (m *mockCallUseCase) AcceptCall(callID uuid.UUID) error { return m.Called(callID).Error(0) }
func (m *mockCallUseCase) RejectCall(callID uuid.UUID) error { return m.Called(callID).Error(0) }
func (m *mockCallUseCase) EndCall(callID uuid.UUID) error    { return m.Called(callID).Error(0) }
func (m *mockCallUseCase) GetActiveCall(userID uuid.UUID) (*domain.Call, error) {
	args := m.Called(userID)
	c, _ := args.Get(0).(*domain.Call)
	return c, args.Error(1)
}
func (m *mockCallUseCase) EndAllActiveCalls(userID uuid.UUID) error {
	return m.Called(userID).Error(0)
}

type mockChannelAccess struct{ mock.Mock }

func (m *mockChannelAccess) CheckChannelAccess(channelID, userID uuid.UUID) (*domain.Channel, error) {
	args := m.Called(channelID, userID)
	ch, _ := args.Get(0).(*domain.Channel)
	return ch, args.Error(1)
}
func (m *mockChannelAccess) GetChannelAudience(channelID uuid.UUID) ([]uuid.UUID, error) {
	args := m.Called(channelID)
	ids, _ := args.Get(0).([]uuid.UUID)
	return ids, args.Error(1)
}

// allowAllChannelAccess grants access to any channel/user pair — the default
// for tests that aren't exercising the access-check itself.
func allowAllChannelAccess() *mockChannelAccess {
	m := &mockChannelAccess{}
	m.On("CheckChannelAccess", mock.Anything, mock.Anything).Return(&domain.Channel{}, nil)
	return m
}

// --- Харнесс ---

// newTestHandler собирает WebSocketHandler с короткими таймаутами и запущенным hub.
func newTestHandler(t *testing.T, userID uuid.UUID) (*WebSocketHandler, *ws.Hub) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	user := &domain.User{ID: userID, Username: "tester", Email: "t@e.st", Status: domain.StatusOffline}

	auth := &mockAuthUseCase{}
	auth.On("ValidateToken", mock.Anything).Return(user, nil)

	users := &mockUserUseCase{}
	users.On("UpdateStatus", userID, mock.Anything).Return(nil)
	users.On("UpdateLastSeen", userID, mock.Anything).Return(nil)

	calls := &mockCallUseCase{}
	calls.On("EndAllActiveCalls", userID).Return(nil)

	hub := ws.NewHub(log)
	go hub.Run()

	h := NewWebSocketHandler(hub, auth, calls, users, allowAllChannelAccess(), log)
	h.pongWait = 100 * time.Millisecond
	h.pingPeriod = 40 * time.Millisecond
	h.writeWait = 50 * time.Millisecond

	return h, hub
}

// dialWS открывает WS-соединение к тестовому серверу.
func dialWS(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/?token=x"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

func TestDeadClientIsCleanedUp(t *testing.T) {
	userID := uuid.New()
	h, hub := newTestHandler(t, userID)

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()

	// Клиент не читает вовсе → gorilla не обрабатывает входящие ping и не шлёт pong,
	// соединение для сервера мёртвое.

	// Дожидаемся регистрации клиента в hub.
	assert.Eventually(t, func() bool { return hub.IsOnline(userID) },
		time.Second, 10*time.Millisecond, "клиент должен зарегистрироваться")

	// Клиент не отвечает pong → сервер должен отвалить его в пределах ~pongWait.
	assert.Eventually(t, func() bool { return !hub.IsOnline(userID) },
		2*time.Second, 20*time.Millisecond, "мёртвый клиент должен быть вычищен из hub")
}

func TestLiveClientStaysOnline(t *testing.T) {
	userID := uuid.New()
	h, hub := newTestHandler(t, userID)

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()

	// Фоновое чтение: gorilla автоматически отвечает pong на серверные ping.
	// Горутина завершится сама, когда defer conn.Close() оборвёт чтение.
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	assert.Eventually(t, func() bool { return hub.IsOnline(userID) },
		time.Second, 10*time.Millisecond, "клиент должен зарегистрироваться")

	// Ждём заметно дольше pongWait; живой клиент не должен отвалиться.
	time.Sleep(300 * time.Millisecond)
	assert.True(t, hub.IsOnline(userID), "живой клиент должен оставаться онлайн")
}

// --- Multi-user test harness (for tests needing more than one distinct user) ---

func newMultiUserTestHandler(t *testing.T, users map[string]*domain.User) (*WebSocketHandler, *ws.Hub) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	auth := &mockAuthUseCase{}
	for token, user := range users {
		auth.On("ValidateToken", token).Return(user, nil)
	}

	userUC := &mockUserUseCase{}
	userUC.On("UpdateStatus", mock.Anything, mock.Anything).Return(nil)
	userUC.On("UpdateLastSeen", mock.Anything, mock.Anything).Return(nil)

	calls := &mockCallUseCase{}
	calls.On("EndAllActiveCalls", mock.Anything).Return(nil)

	hub := ws.NewHub(log)
	go hub.Run()

	h := NewWebSocketHandler(hub, auth, calls, userUC, allowAllChannelAccess(), log)
	h.pongWait = 200 * time.Millisecond
	h.pingPeriod = 80 * time.Millisecond
	h.writeWait = 100 * time.Millisecond

	return h, hub
}

func dialWSWithToken(t *testing.T, srv *httptest.Server, token string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/?token=" + token
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

func sendJSON(t *testing.T, conn *websocket.Conn, msgType string, payload interface{}) {
	t.Helper()
	p, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	msg := ws.Message{Type: msgType, Payload: p}
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("marshal message: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		t.Fatalf("write message: %v", err)
	}
}

func readUntilType(t *testing.T, conn *websocket.Conn, wantType string, timeout time.Duration) []byte {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("did not receive %q message before timeout: %v", wantType, err)
		}
		var msg ws.Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == wantType {
			return data
		}
	}
}

// assertNoMessageOfType fails if a message of wantType arrives on conn within
// timeout. Other message types (user_joined, online_users, …) are ignored.
func assertNoMessageOfType(t *testing.T, conn *websocket.Conn, wantType string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			return // timed out / closed — nothing of wantType arrived
		}
		var msg ws.Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == wantType {
			t.Fatalf("client unexpectedly received %q message: %s", wantType, data)
		}
	}
}

// --- Tests ---

func TestVoiceJoinedBroadcastsParticipants(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()
	channelID := uuid.New()

	h, _ := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-a": {ID: userA, Username: "alice", Email: "a@e.st", Status: domain.StatusOffline},
		"token-b": {ID: userB, Username: "bob", Email: "b@e.st", Status: domain.StatusOffline},
	})

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connA := dialWSWithToken(t, srv, "token-a")
	defer connA.Close()
	connB := dialWSWithToken(t, srv, "token-b")
	defer connB.Close()

	sendJSON(t, connA, "voice_joined", map[string]string{"channel_id": channelID.String()})

	msg := readUntilType(t, connB, "voice_participants", 2*time.Second)
	assert.Contains(t, string(msg), channelID.String())
	assert.Contains(t, string(msg), userA.String())
}

func TestVoiceLeftBroadcastsParticipants(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()
	channelID := uuid.New()

	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-a": {ID: userA, Username: "alice", Email: "a@e.st", Status: domain.StatusOffline},
		"token-b": {ID: userB, Username: "bob", Email: "b@e.st", Status: domain.StatusOffline},
	})

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connA := dialWSWithToken(t, srv, "token-a")
	defer connA.Close()
	connB := dialWSWithToken(t, srv, "token-b")
	defer connB.Close()

	assert.Eventually(t, func() bool { return hub.IsOnline(userA) && hub.IsOnline(userB) },
		time.Second, 10*time.Millisecond)

	hub.JoinVoiceChannel(userA, channelID)

	// Фоновое чтение connA: держим соединение "живым" для gorilla (auto-pong
	// на серверные ping), чтобы тест не мог пройти через фолбэк
	// Hub.Run()'s unregister-на-мёртвое-соединение — только через реальный
	// handleVoiceLeft.
	go func() {
		for {
			if _, _, err := connA.ReadMessage(); err != nil {
				return
			}
		}
	}()

	sendJSON(t, connA, "voice_left", map[string]string{"channel_id": channelID.String()})

	msg := readUntilType(t, connB, "voice_participants", 2*time.Second)
	assert.Contains(t, string(msg), channelID.String())
	assert.NotContains(t, string(msg), userA.String())
}

func TestConnectionQualityBroadcast(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()

	h, _ := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-a": {ID: userA, Username: "alice", Email: "a@e.st", Status: domain.StatusOffline},
		"token-b": {ID: userB, Username: "bob", Email: "b@e.st", Status: domain.StatusOffline},
	})

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connA := dialWSWithToken(t, srv, "token-a")
	defer connA.Close()
	connB := dialWSWithToken(t, srv, "token-b")
	defer connB.Close()

	sendJSON(t, connA, "connection_quality", map[string]interface{}{
		"level":       "poor",
		"packet_loss": 7.5,
		"rtt":         320,
		"bitrate":     40,
	})

	msg := readUntilType(t, connB, "connection_quality", 2*time.Second)
	assert.Contains(t, string(msg), userA.String())
	assert.Contains(t, string(msg), "poor")
}

func TestHandleJoinChannel_DeniedAccess_DoesNotSetCurrentChannel(t *testing.T) {
	userID := uuid.New()
	channelID := uuid.New()
	h, hub := newTestHandler(t, userID)
	access := &mockChannelAccess{}
	access.On("CheckChannelAccess", channelID, userID).Return(nil, domain.ErrChannelForbidden)
	h.channelAccess = access

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	conn := dialWS(t, srv)
	defer conn.Close()

	sendJSON(t, conn, "join_channel", map[string]string{"channel_id": channelID.String()})
	assert.Eventually(t, func() bool { return hub.IsOnline(userID) }, time.Second, 10*time.Millisecond)

	// Give handleJoinChannel time to run, then verify SendToChannel does NOT
	// reach this client — proof CurrentChannelID was never set to channelID.
	time.Sleep(100 * time.Millisecond)
	hub.SendToChannel(channelID, &ws.Message{Type: "probe", Payload: []byte(`{}`)})

	conn.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	_, data, err := conn.ReadMessage()
	if err == nil && strings.Contains(string(data), `"probe"`) {
		t.Fatalf("client received channel message despite denied join_channel: %s", data)
	}
}

// TestHandleJoinChannel_DeniedAccess_ClearsPreviousChannel: a denial must also
// drop the channel the client was previously viewing — otherwise a user whose
// access was revoked keeps receiving that channel's events via SendToChannel.
func TestHandleJoinChannel_DeniedAccess_ClearsPreviousChannel(t *testing.T) {
	userID := uuid.New()
	channelA := uuid.New()
	channelB := uuid.New()

	h, hub := newTestHandler(t, userID)
	access := &mockChannelAccess{}
	access.On("CheckChannelAccess", channelA, userID).Return(&domain.Channel{}, nil)
	access.On("CheckChannelAccess", channelB, userID).Return(nil, domain.ErrChannelForbidden)
	h.channelAccess = access
	// This test deliberately pauses between reads; the default 100ms pongWait of
	// newTestHandler would reap the connection as dead mid-test.
	h.pongWait = 5 * time.Second
	h.pingPeriod = 2 * time.Second

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	conn := dialWS(t, srv)
	defer conn.Close()

	assert.Eventually(t, func() bool { return hub.IsOnline(userID) }, time.Second, 10*time.Millisecond)

	// Successfully view channel A, and prove events for A reach this client.
	sendJSON(t, conn, "join_channel", map[string]string{"channel_id": channelA.String()})
	time.Sleep(100 * time.Millisecond)
	hub.SendToChannel(channelA, &ws.Message{Type: "probe_a", Payload: []byte(`{}`)})
	readUntilType(t, conn, "probe_a", 2*time.Second)

	// Now a denied join for B must clear the client's current channel entirely.
	sendJSON(t, conn, "join_channel", map[string]string{"channel_id": channelB.String()})
	time.Sleep(100 * time.Millisecond)

	hub.SendToChannel(channelA, &ws.Message{Type: "probe_b", Payload: []byte(`{}`)})
	assertNoMessageOfType(t, conn, "probe_b", 300*time.Millisecond)
}

func TestVoiceCallRing_PrivateChannel_OnlyAudienceReceives(t *testing.T) {
	caller := uuid.New()
	insider := uuid.New()
	outsider := uuid.New()
	channelID := uuid.New()

	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-caller":   {ID: caller, Username: "caller", Email: "c@e.st", Status: domain.StatusOffline},
		"token-insider":  {ID: insider, Username: "insider", Email: "i@e.st", Status: domain.StatusOffline},
		"token-outsider": {ID: outsider, Username: "outsider", Email: "o@e.st", Status: domain.StatusOffline},
	})
	access := &mockChannelAccess{}
	access.On("CheckChannelAccess", channelID, caller).Return(&domain.Channel{}, nil)
	access.On("GetChannelAudience", channelID).Return([]uuid.UUID{caller, insider}, nil)
	h.channelAccess = access

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connCaller := dialWSWithToken(t, srv, "token-caller")
	defer connCaller.Close()
	connInsider := dialWSWithToken(t, srv, "token-insider")
	defer connInsider.Close()
	connOutsider := dialWSWithToken(t, srv, "token-outsider")
	defer connOutsider.Close()

	assert.Eventually(t, func() bool {
		return hub.IsOnline(caller) && hub.IsOnline(insider) && hub.IsOnline(outsider)
	}, time.Second, 10*time.Millisecond)

	sendJSON(t, connCaller, "voice_call_ring", map[string]string{
		"channel_id":   channelID.String(),
		"channel_name": "secret-channel",
		"caller_id":    caller.String(),
	})

	msg := readUntilType(t, connInsider, "voice_call_ring", 2*time.Second)
	assert.Contains(t, string(msg), "secret-channel")

	assertNoMessageOfType(t, connOutsider, "voice_call_ring", 300*time.Millisecond)
}

// A transient audience-lookup error must drop the event rather than fall
// back to broadcasting it to everyone — the channel could be private, so
// broadcasting on error would leak the ring to non-members.
func TestVoiceCallRing_AudienceLookupError_FailsClosed(t *testing.T) {
	caller := uuid.New()
	insider := uuid.New()
	outsider := uuid.New()
	channelID := uuid.New()

	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-caller":   {ID: caller, Username: "caller", Email: "c@e.st", Status: domain.StatusOffline},
		"token-insider":  {ID: insider, Username: "insider", Email: "i@e.st", Status: domain.StatusOffline},
		"token-outsider": {ID: outsider, Username: "outsider", Email: "o@e.st", Status: domain.StatusOffline},
	})
	access := &mockChannelAccess{}
	access.On("CheckChannelAccess", channelID, caller).Return(&domain.Channel{}, nil)
	access.On("GetChannelAudience", channelID).Return([]uuid.UUID(nil), errors.New("audience lookup boom"))
	h.channelAccess = access

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connCaller := dialWSWithToken(t, srv, "token-caller")
	defer connCaller.Close()
	connInsider := dialWSWithToken(t, srv, "token-insider")
	defer connInsider.Close()
	connOutsider := dialWSWithToken(t, srv, "token-outsider")
	defer connOutsider.Close()

	assert.Eventually(t, func() bool {
		return hub.IsOnline(caller) && hub.IsOnline(insider) && hub.IsOnline(outsider)
	}, time.Second, 10*time.Millisecond)

	sendJSON(t, connCaller, "voice_call_ring", map[string]string{
		"channel_id":   channelID.String(),
		"channel_name": "secret-channel",
		"caller_id":    caller.String(),
	})

	assertNoMessageOfType(t, connInsider, "voice_call_ring", 300*time.Millisecond)
	assertNoMessageOfType(t, connOutsider, "voice_call_ring", 300*time.Millisecond)
}

func TestVoiceCallCancel_PrivateChannel_OnlyAudienceReceives(t *testing.T) {
	caller := uuid.New()
	insider := uuid.New()
	outsider := uuid.New()
	channelID := uuid.New()

	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-caller":   {ID: caller, Username: "caller", Email: "c@e.st", Status: domain.StatusOffline},
		"token-insider":  {ID: insider, Username: "insider", Email: "i@e.st", Status: domain.StatusOffline},
		"token-outsider": {ID: outsider, Username: "outsider", Email: "o@e.st", Status: domain.StatusOffline},
	})
	access := &mockChannelAccess{}
	access.On("CheckChannelAccess", channelID, caller).Return(&domain.Channel{}, nil)
	access.On("GetChannelAudience", channelID).Return([]uuid.UUID{caller, insider}, nil)
	h.channelAccess = access

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connCaller := dialWSWithToken(t, srv, "token-caller")
	defer connCaller.Close()
	connInsider := dialWSWithToken(t, srv, "token-insider")
	defer connInsider.Close()
	connOutsider := dialWSWithToken(t, srv, "token-outsider")
	defer connOutsider.Close()

	assert.Eventually(t, func() bool {
		return hub.IsOnline(caller) && hub.IsOnline(insider) && hub.IsOnline(outsider)
	}, time.Second, 10*time.Millisecond)

	sendJSON(t, connCaller, "voice_call_cancel", map[string]string{
		"channel_id":   channelID.String(),
		"channel_name": "secret-channel",
	})

	msg := readUntilType(t, connInsider, "voice_call_cancel", 2*time.Second)
	assert.Contains(t, string(msg), "secret-channel")

	assertNoMessageOfType(t, connOutsider, "voice_call_cancel", 300*time.Millisecond)
}

// A public channel (nil audience) keeps the pre-existing broadcast-to-everyone
// behavior — every connected client sees the ring, not just channel viewers.
func TestVoiceCallRing_PublicChannel_BroadcastsToEveryone(t *testing.T) {
	caller := uuid.New()
	other := uuid.New()
	channelID := uuid.New()

	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-caller": {ID: caller, Username: "caller", Email: "c@e.st", Status: domain.StatusOffline},
		"token-other":  {ID: other, Username: "other", Email: "o@e.st", Status: domain.StatusOffline},
	})
	access := &mockChannelAccess{}
	access.On("CheckChannelAccess", channelID, caller).Return(&domain.Channel{}, nil)
	access.On("GetChannelAudience", channelID).Return(nil, nil)
	h.channelAccess = access

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connCaller := dialWSWithToken(t, srv, "token-caller")
	defer connCaller.Close()
	connOther := dialWSWithToken(t, srv, "token-other")
	defer connOther.Close()

	assert.Eventually(t, func() bool { return hub.IsOnline(caller) && hub.IsOnline(other) },
		time.Second, 10*time.Millisecond)

	sendJSON(t, connCaller, "voice_call_ring", map[string]string{"channel_id": channelID.String()})

	msg := readUntilType(t, connOther, "voice_call_ring", 2*time.Second)
	assert.Contains(t, string(msg), channelID.String())
}

// A client that cannot access the channel it claims to ring for must not cause
// any delivery at all.
func TestVoiceCallRing_DeniedSender_SendsNothing(t *testing.T) {
	caller := uuid.New()
	other := uuid.New()
	channelID := uuid.New()

	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-caller": {ID: caller, Username: "caller", Email: "c@e.st", Status: domain.StatusOffline},
		"token-other":  {ID: other, Username: "other", Email: "o@e.st", Status: domain.StatusOffline},
	})
	access := &mockChannelAccess{}
	access.On("CheckChannelAccess", channelID, caller).Return(nil, domain.ErrChannelForbidden)
	h.channelAccess = access

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connCaller := dialWSWithToken(t, srv, "token-caller")
	defer connCaller.Close()
	connOther := dialWSWithToken(t, srv, "token-other")
	defer connOther.Close()

	assert.Eventually(t, func() bool { return hub.IsOnline(caller) && hub.IsOnline(other) },
		time.Second, 10*time.Millisecond)

	sendJSON(t, connCaller, "voice_call_ring", map[string]string{"channel_id": channelID.String()})

	assertNoMessageOfType(t, connOther, "voice_call_ring", 300*time.Millisecond)
	access.AssertNotCalled(t, "GetChannelAudience", mock.Anything)
}

func TestVoiceJoined_DeniedAccess_DoesNotJoinRoster(t *testing.T) {
	userA := uuid.New()
	channelID := uuid.New()

	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-a": {ID: userA, Username: "alice", Email: "a@e.st", Status: domain.StatusOffline},
	})
	access := &mockChannelAccess{}
	access.On("CheckChannelAccess", channelID, userA).Return(nil, domain.ErrChannelForbidden)
	h.channelAccess = access

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()
	conn := dialWSWithToken(t, srv, "token-a")
	defer conn.Close()

	sendJSON(t, conn, "voice_joined", map[string]string{"channel_id": channelID.String()})

	assert.Eventually(t, func() bool { return hub.IsOnline(userA) }, time.Second, 10*time.Millisecond)
	time.Sleep(100 * time.Millisecond)

	_, ok := hub.GetVoiceState()[channelID]
	assert.False(t, ok, "denied user must not appear in the voice channel roster")
}

// TestReadPump_RealDisconnect_UpdatesLastSeen: a genuine client disconnect
// (not a reconnect-driven replacement) must call UpdateLastSeen, in the same
// guarded branch that already calls UpdateStatus(..., StatusOffline).
func TestReadPump_RealDisconnect_UpdatesLastSeen(t *testing.T) {
	userID := uuid.New()
	h, hub := newTestHandler(t, userID)

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	conn := dialWS(t, srv)
	assert.Eventually(t, func() bool { return hub.IsOnline(userID) }, time.Second, 10*time.Millisecond)

	conn.Close()

	mockUC := h.userUseCase.(*mockUserUseCase)
	assert.Eventually(t, func() bool {
		for _, c := range mockUC.Calls {
			if c.Method == "UpdateLastSeen" {
				return true
			}
		}
		return false
	}, time.Second, 10*time.Millisecond, "UpdateLastSeen must be called after a real disconnect")
}

// TestReadPump_StaleReconnectedConnection_DoesNotUpdateLastSeen: when a
// second connection for the same user replaces the first, the OLD
// connection's eventual teardown (forced closed by the hub on register) must
// NOT call UpdateLastSeen — that would incorrectly overwrite the live
// connection's presence with a stale timestamp. Mirrors the existing
// wasCurrent guard already covering UpdateStatus.
func TestReadPump_StaleReconnectedConnection_DoesNotUpdateLastSeen(t *testing.T) {
	userID := uuid.New()
	h, hub := newMultiUserTestHandler(t, map[string]*domain.User{
		"tok": {ID: userID, Username: "tester", Email: "t@e.st", Status: domain.StatusOffline},
	})

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	oldConn := dialWSWithToken(t, srv, "tok")
	assert.Eventually(t, func() bool { return hub.IsOnline(userID) }, time.Second, 10*time.Millisecond)

	newConn := dialWSWithToken(t, srv, "tok") // reconnect: hub force-closes oldConn's socket
	defer newConn.Close()

	// Background reader: gorilla only auto-answers server Pings with Pongs
	// while something is calling ReadMessage. Without this, newConn itself
	// would go unanswered past pongWait and die within this test's own sleep
	// window, producing a legitimate UpdateLastSeen call for ITS OWN teardown
	// that has nothing to do with the guard under test. Mirrors
	// TestLiveClientStaysOnline's keepalive pattern.
	go func() {
		for {
			if _, _, err := newConn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	// Give the old connection's readPump time to observe the forced close and
	// run its defer with wasCurrent == false.
	time.Sleep(300 * time.Millisecond)

	mockUC := h.userUseCase.(*mockUserUseCase)
	for _, c := range mockUC.Calls {
		if c.Method == "UpdateLastSeen" {
			t.Fatalf("UpdateLastSeen must not be called for the stale connection's teardown")
		}
	}

	oldConn.Close() // already dead on the server side — releases the client-side handle only
}
