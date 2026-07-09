package handler

import (
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
