# WS ping/pong keepalive + read deadline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сервер сам шлёт WebSocket ping-фреймы и держит read deadline, чтобы мёртвые соединения вычищались из hub, а не висели вечно.

**Architecture:** Стандартный паттерн gorilla/websocket. `writePump` по тикеру `pingPeriod` шлёт `PingMessage`; `readPump` ставит read deadline `pongWait` и продлевает его в `PongHandler` при каждом pong. Если pong не приходит — `ReadMessage()` возвращает ошибку и срабатывает уже существующий `defer` с очисткой клиента. Таймауты — поля структуры `WebSocketHandler` с дефолтными константами, что позволяет тесту укоротить их.

**Tech Stack:** Go 1.24, `github.com/gorilla/websocket` v1.5.3, `github.com/stretchr/testify` (mock + assert), `net/http/httptest`.

## Global Constraints

- Изменения только в `server/internal/delivery/http/handler/websocket.go` + новый `websocket_test.go`. Фронтенд и app-level `ping`/`pong` не трогать.
- Дефолтные таймауты — стандартные gorilla: `writeWait=10s`, `pongWait=60s`, `pingPeriod=(pongWait*9)/10=54s`. Задаются константами, не через env/config.
- `pingPeriod` строго меньше `pongWait`.
- Существующий `defer` в `readPump` (Unregister + Close + UpdateStatus offline) и цикл `ReadMessage()` остаются рабочими.
- `go build ./...` и `go vet ./...` должны быть чистыми. Все команды запускать из каталога `server/`.

---

### Task 1: Таймауты + ping/deadline в pump'ах (с тестом мёртвого клиента)

**Files:**
- Modify: `server/internal/delivery/http/handler/websocket.go` (импорт `time`; поля `writeWait/pongWait/pingPeriod` в `WebSocketHandler`; константы; `NewWebSocketHandler`; `readPump`; `writePump`)
- Test: `server/internal/delivery/http/handler/websocket_test.go` (создать)

**Interfaces:**
- Consumes: `ws.NewHub(log *slog.Logger) *ws.Hub`, `hub.Run()`, `hub.IsOnline(uuid.UUID) bool`; `NewWebSocketHandler(hub, authUseCase, callUseCase, userUseCase, log) *WebSocketHandler`; `(*WebSocketHandler).HandleWebSocket(http.ResponseWriter, *http.Request)`.
- Produces: неэкспортируемые поля `writeWait`, `pongWait`, `pingPeriod time.Duration` на `WebSocketHandler`, заполняемые дефолтными константами `defaultWriteWait`, `defaultPongWait`, `defaultPingPeriod`. Тест (пакет `handler`) переопределяет их напрямую.

- [ ] **Step 1: Написать падающий тест мёртвого клиента**

Создать `server/internal/delivery/http/handler/websocket_test.go`. Он поднимает `HandleWebSocket` через `httptest`, подключается gorilla-клиентом, глушит авто-pong (`SetPingHandler(no-op)`) и перестаёт читать, затем проверяет, что клиент ушёл из hub.

```go
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

	"github.com/vycord/server/internal/domain"
	ws "github.com/vycord/server/internal/delivery/ws"
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

	// Глушим авто-pong gorilla, чтобы соединение считалось мёртвым.
	conn.SetPingHandler(func(string) error { return nil })

	// Дожидаемся регистрации клиента в hub.
	assert.Eventually(t, func() bool { return hub.IsOnline(userID) },
		time.Second, 10*time.Millisecond, "клиент должен зарегистрироваться")

	// Клиент не отвечает pong → сервер должен отвалить его в пределах ~pongWait.
	assert.Eventually(t, func() bool { return !hub.IsOnline(userID) },
		2*time.Second, 20*time.Millisecond, "мёртвый клиент должен быть вычищен из hub")
}
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd server && go test ./internal/delivery/http/handler/ -run TestDeadClientIsCleanedUp -v`
Expected: FAIL. Компиляция может не пройти (нет полей `pongWait`/`pingPeriod`/`writeWait`) — это ожидаемо; если компилируется, тест зависает и падает по таймауту, т.к. без read deadline мёртвый клиент не вычищается.

- [ ] **Step 3: Добавить константы, поля и импорт `time`**

В `server/internal/delivery/http/handler/websocket.go` добавить `"time"` в импорты. После блока импортов добавить константы:

```go
const (
	defaultWriteWait  = 10 * time.Second
	defaultPongWait   = 60 * time.Second
	defaultPingPeriod = (defaultPongWait * 9) / 10
)
```

В структуру `WebSocketHandler` добавить поля:

```go
	writeWait  time.Duration
	pongWait   time.Duration
	pingPeriod time.Duration
```

В `NewWebSocketHandler` заполнить их в возвращаемом литерале:

```go
	return &WebSocketHandler{
		hub:         hub,
		authUseCase: authUseCase,
		callUseCase: callUseCase,
		userUseCase: userUseCase,
		log:         log,
		writeWait:   defaultWriteWait,
		pongWait:    defaultPongWait,
		pingPeriod:  defaultPingPeriod,
	}
```

- [ ] **Step 4: Добавить read deadline и PongHandler в `readPump`**

В `readPump`, сразу после блока `defer func(){...}()` и перед `for {`, вставить:

```go
	client.Conn.SetReadDeadline(time.Now().Add(h.pongWait))
	client.Conn.SetPongHandler(func(string) error {
		client.Conn.SetReadDeadline(time.Now().Add(h.pongWait))
		return nil
	})
```

- [ ] **Step 5: Переписать `writePump` под тикер с ping**

Заменить тело `writePump` целиком:

```go
func (h *WebSocketHandler) writePump(client *ws.Client) {
	ticker := time.NewTicker(h.pingPeriod)
	defer func() {
		ticker.Stop()
		client.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-client.Send:
			client.Conn.SetWriteDeadline(time.Now().Add(h.writeWait))
			if !ok {
				client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			w, err := client.Conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)
			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			client.Conn.SetWriteDeadline(time.Now().Add(h.writeWait))
			if err := client.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
```

- [ ] **Step 6: Запустить тест — убедиться, что проходит**

Run: `cd server && go test ./internal/delivery/http/handler/ -run TestDeadClientIsCleanedUp -v`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add server/internal/delivery/http/handler/websocket.go server/internal/delivery/http/handler/websocket_test.go
git commit -m "VYC-28 WS: ping-фреймы + read deadline — вычистка мёртвых соединений

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Тест «живой клиент остаётся онлайн»

**Files:**
- Test: `server/internal/delivery/http/handler/websocket_test.go` (добавить тест-функцию)

**Interfaces:**
- Consumes: харнесс `newTestHandler`, `dialWS` и моки из Task 1; `hub.IsOnline`.
- Produces: —

- [ ] **Step 1: Добавить тест живого клиента**

Дописать в конец `websocket_test.go`. Клиент читает в фоне — gorilla сам отвечает pong на ping, поэтому клиент должен остаться онлайн дольше нескольких `pingPeriod`.

```go
func TestLiveClientStaysOnline(t *testing.T) {
	userID := uuid.New()
	h, hub := newTestHandler(t, userID)

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	conn := dialWS(t, srv)
	defer conn.Close()

	// Фоновое чтение: gorilla автоматически отвечает pong на серверные ping.
	done := make(chan struct{})
	go func() {
		defer close(done)
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
```

- [ ] **Step 2: Запустить оба теста пакета**

Run: `cd server && go test ./internal/delivery/http/handler/ -v`
Expected: PASS для `TestDeadClientIsCleanedUp` и `TestLiveClientStaysOnline`.

- [ ] **Step 3: Прогнать build и vet**

Run: `cd server && go build ./... && go vet ./...`
Expected: без вывода (успех).

- [ ] **Step 4: Коммит**

```bash
git add server/internal/delivery/http/handler/websocket_test.go
git commit -m "VYC-28 WS: тест — живой клиент остаётся онлайн через ping/pong

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- readPump read deadline + PongHandler → Task 1 Step 4. ✓
- writePump ping ticker + write deadline → Task 1 Step 5. ✓
- Таймауты-константы (gorilla defaults) → Task 1 Step 3. ✓
- Таймауты как поля структуры для тестов → Task 1 Step 3 + переопределение в `newTestHandler`. ✓
- Моки трёх usecase'ов → Task 1 Step 1. ✓
- Кейс «мёртвый клиент вычищается» → Task 1. ✓
- Кейс «живой клиент остаётся» → Task 2. ✓
- Фронт/app-level ping не трогаются → нет соответствующих задач (по замыслу). ✓
- `go build`/`go vet` чистые → Task 2 Step 3. ✓

**Placeholder scan:** плейсхолдеров/TODO нет; весь код приведён целиком.

**Type consistency:** поля `writeWait/pongWait/pingPeriod` и константы `defaultWriteWait/defaultPongWait/defaultPingPeriod` согласованы между Task 1 Step 3 и `newTestHandler`. Сигнатуры моков соответствуют интерфейсам `domain.AuthUseCase` (3 метода), `domain.UserUseCase` (5 методов), `domain.CallUseCase` (6 методов). Порядок аргументов `NewWebSocketHandler(hub, auth, call, user, log)` совпадает с текущим кодом.
