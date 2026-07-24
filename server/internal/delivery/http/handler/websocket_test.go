package handler

import (
	"encoding/json"
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

func (m *mockAuthUseCase) Register(username, email, password string) (*domain.User, string, error) {
	args := m.Called(username, email, password)
	u, _ := args.Get(0).(*domain.User)
	return u, args.String(1), args.Error(2)
}
func (m *mockAuthUseCase) Login(email, password string) (*domain.User, string, error) {
	args := m.Called(email, password)
	u, _ := args.Get(0).(*domain.User)
	return u, args.String(1), args.Error(2)
}
func (m *mockAuthUseCase) ValidateToken(tokenString string) (*domain.User, error) {
	args := m.Called(tokenString)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
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

	calls := &mockCallUseCase{}
	calls.On("EndAllActiveCalls", userID).Return(nil)

	hub := ws.NewHub(log)
	go hub.Run()

	h := NewWebSocketHandler(hub, auth, calls, users, log)
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

	calls := &mockCallUseCase{}
	calls.On("EndAllActiveCalls", mock.Anything).Return(nil)

	hub := ws.NewHub(log)
	go hub.Run()

	h := NewWebSocketHandler(hub, auth, calls, userUC, log)
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
