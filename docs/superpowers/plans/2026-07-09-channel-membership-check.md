# Channel Membership Check (REST messages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Запретить чтение и отправку REST-сообщений в каналы серверов, участником которых пользователь не является.

**Architecture:** Проверка членства выполняется в usecase-слое (`messageUseCase`): по `channelID` берём канал (`channelRepo.GetByID`), из него `ServerID`, и проверяем `serverRepo.IsMember`. Доменные ошибки (`ErrChannelNotFound`, `ErrForbidden`) транслируются хендлером в HTTP 404/403. Заодно чинится мёртвая проверка `sql.ErrNoRows` в `channelRepo.GetByID` (pgx возвращает `pgx.ErrNoRows`).

**Tech Stack:** Go 1.24, `jackc/pgx/v5`, `net/http` (ServeMux), `stretchr/testify` (mock+assert).

## Global Constraints

- Go-модуль: `github.com/vycord/server`; все внутренние импорты через этот префикс.
- Тесты usecase живут в пакете `usecase_test`, моки — на `github.com/stretchr/testify/mock`, ассерты — на `testify/assert` (как в `internal/usecase/auth_test.go`).
- Каждый коммит должен оставлять `go build ./...` зелёным.
- Стиль сообщений коммитов репозитория: префикс `VYC-27 ...`. **Коммиты и пуш выполняет пользователь сам** — шаги «Commit» приведены для полноты, согласуйте фактический коммит с пользователем.
- Все команды запускать из каталога `server/`.

---

### Task 1: Доменные сентинел-ошибки + фикс детекта «канал не найден» в репозитории

**Files:**
- Create: `server/internal/domain/errors.go`
- Modify: `server/internal/repository/postgres/channel.go:1-13` (импорты), `server/internal/repository/postgres/channel.go:52-81` (`GetByID`)

**Interfaces:**
- Consumes: `github.com/jackc/pgx/v5` (`pgx.ErrNoRows`), стандартный `errors`.
- Produces:
  - `domain.ErrForbidden` (`error`) — пользователь не участник сервера.
  - `domain.ErrChannelNotFound` (`error`) — канал не существует; `channelRepo.GetByID` возвращает его (обёрнутым через `%w`) при `pgx.ErrNoRows`.

- [ ] **Step 1: Создать файл доменных ошибок**

Create `server/internal/domain/errors.go`:

```go
package domain

import "errors"

// Доменные сентинел-ошибки. Хендлеры транслируют их в HTTP-статусы через errors.Is.
var (
	// ErrForbidden — пользователь не участник сервера, доступ запрещён.
	ErrForbidden = errors.New("access denied")
	// ErrChannelNotFound — канал с указанным ID не существует.
	ErrChannelNotFound = errors.New("channel not found")
)
```

- [ ] **Step 2: Починить импорты в channel.go**

В `server/internal/repository/postgres/channel.go` заменить блок импортов (строки 1-13) на:

```go
package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)
```

(Убрали `database/sql`, добавили `errors` и `github.com/jackc/pgx/v5`.)

- [ ] **Step 3: Заменить проверку «не найдено» в GetByID**

В `server/internal/repository/postgres/channel.go`, в методе `GetByID`, заменить:

```go
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("channel not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get channel: %w", err)
	}
```

на:

```go
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("channel %s: %w", id, domain.ErrChannelNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get channel: %w", err)
	}
```

- [ ] **Step 4: Проверить сборку и что ничего не сломалось**

Run: `cd server && go build ./... && go test ./...`
Expected: сборка успешна; существующие тесты (`auth`, `turn`, `authtoken`, sfu) — PASS. Новых тестов пока нет.

Примечание: поведение `GetByID` покрывается косвенно через usecase-тесты в Task 2 (мок репозитория возвращает `ErrChannelNotFound`); отдельный тест репозитория не пишем (нужна БД).

- [ ] **Step 5: Commit**

```bash
cd server && git add internal/domain/errors.go internal/repository/postgres/channel.go
git commit -m "VYC-27 Доменные ошибки ErrForbidden/ErrChannelNotFound + фикс pgx.ErrNoRows в channelRepo"
```

---

### Task 2: Проверка членства в messageUseCase + маппинг ошибок в хендлере (TDD)

**Files:**
- Create: `server/internal/usecase/message_test.go`
- Modify: `server/internal/domain/usecase.go:30-33` (интерфейс `MessageUseCase`)
- Modify: `server/internal/usecase/message.go` (весь файл)
- Modify: `server/internal/delivery/http/handler/message.go` (импорты, `CreateMessage`, `GetMessages`, +хелпер)
- Modify: `server/cmd/api/main.go:80` (конструктор usecase)

**Interfaces:**
- Consumes из Task 1: `domain.ErrForbidden`, `domain.ErrChannelNotFound`. Существующие: `domain.ChannelRepository.GetByID(uuid.UUID) (*domain.Channel, error)`, `domain.ServerRepository.IsMember(serverID, userID uuid.UUID) (bool, error)`, `domain.MessageRepository.Create(*domain.Message) error` / `.GetByChannelID(channelID uuid.UUID, limit, offset int) ([]*domain.Message, error)`.
- Produces:
  - `usecase.NewMessageUseCase(messageRepo domain.MessageRepository, channelRepo domain.ChannelRepository, serverRepo domain.ServerRepository) domain.MessageUseCase`.
  - `domain.MessageUseCase.GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*domain.Message, error)` (добавлен `userID`).
  - `domain.MessageUseCase.CreateMessage(channelID, userID uuid.UUID, content string) (*domain.Message, error)` (сигнатура без изменений, поведение — с проверкой членства).

- [ ] **Step 1: Написать падающий тест (моки + кейсы)**

Create `server/internal/usecase/message_test.go`:

```go
package usecase_test

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

// --- Моки репозиториев ---

type MockMessageRepository struct{ mock.Mock }

func (m *MockMessageRepository) Create(msg *domain.Message) error {
	return m.Called(msg).Error(0)
}
func (m *MockMessageRepository) GetByID(id uuid.UUID) (*domain.Message, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Message), args.Error(1)
}
func (m *MockMessageRepository) GetByChannelID(channelID uuid.UUID, limit, offset int) ([]*domain.Message, error) {
	args := m.Called(channelID, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Message), args.Error(1)
}
func (m *MockMessageRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	return m.Called(id, updates).Error(0)
}
func (m *MockMessageRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}

type MockChannelRepository struct{ mock.Mock }

func (m *MockChannelRepository) Create(channel *domain.Channel) error {
	return m.Called(channel).Error(0)
}
func (m *MockChannelRepository) GetByID(id uuid.UUID) (*domain.Channel, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Channel), args.Error(1)
}
func (m *MockChannelRepository) GetByServerID(serverID uuid.UUID) ([]*domain.Channel, error) {
	args := m.Called(serverID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Channel), args.Error(1)
}
func (m *MockChannelRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	return m.Called(id, updates).Error(0)
}
func (m *MockChannelRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}

type MockServerRepository struct{ mock.Mock }

func (m *MockServerRepository) Create(server *domain.Server) error {
	return m.Called(server).Error(0)
}
func (m *MockServerRepository) GetByID(id uuid.UUID) (*domain.Server, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Server), args.Error(1)
}
func (m *MockServerRepository) GetByOwner(ownerID uuid.UUID) ([]*domain.Server, error) {
	args := m.Called(ownerID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Server), args.Error(1)
}
func (m *MockServerRepository) GetByMember(userID uuid.UUID) ([]*domain.Server, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Server), args.Error(1)
}
func (m *MockServerRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	return m.Called(id, updates).Error(0)
}
func (m *MockServerRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}
func (m *MockServerRepository) Search(query string, limit, offset int) ([]*domain.Server, error) {
	args := m.Called(query, limit, offset)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Server), args.Error(1)
}
func (m *MockServerRepository) AddMember(serverID, userID uuid.UUID) error {
	return m.Called(serverID, userID).Error(0)
}
func (m *MockServerRepository) RemoveMember(serverID, userID uuid.UUID) error {
	return m.Called(serverID, userID).Error(0)
}
func (m *MockServerRepository) IsMember(serverID, userID uuid.UUID) (bool, error) {
	args := m.Called(serverID, userID)
	return args.Bool(0), args.Error(1)
}

// --- Тесты ---

func TestCreateMessage_Member_Success(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("Create", mock.AnythingOfType("*domain.Message")).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.CreateMessage(channelID, userID, "hello")

	assert.NoError(t, err)
	assert.NotNil(t, msg)
	assert.Equal(t, "hello", msg.Content)
	assert.Equal(t, userID, msg.UserID)
	msgRepo.AssertCalled(t, "Create", mock.AnythingOfType("*domain.Message"))
}

func TestCreateMessage_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.CreateMessage(channelID, userID, "hello")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateMessage_ChannelNotFound(t *testing.T) {
	channelID, userID := uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(nil, fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.CreateMessage(channelID, userID, "hello")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrChannelNotFound)
	srvRepo.AssertNotCalled(t, "IsMember", mock.Anything, mock.Anything)
	msgRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestGetMessages_Member_ReturnsMessages(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	want := []*domain.Message{{ID: uuid.New(), ChannelID: channelID, Content: "hi"}}
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return(want, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	got, err := uc.GetMessages(channelID, userID, 0, 0) // limit 0 -> нормализуется в 50

	assert.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestGetMessages_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	got, err := uc.GetMessages(channelID, userID, 50, 0)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetByChannelID", mock.Anything, mock.Anything, mock.Anything)
}
```

- [ ] **Step 2: Запустить тест — убедиться, что не компилируется/падает**

Run: `cd server && go test ./internal/usecase/ -run 'TestCreateMessage|TestGetMessages' -v`
Expected: FAIL — компиляция не проходит (`NewMessageUseCase` ожидает 2 аргумента, `GetMessages` — 3). Это ожидаемо до реализации.

- [ ] **Step 3: Обновить интерфейс MessageUseCase**

В `server/internal/domain/usecase.go` заменить блок (строки 30-33):

```go
type MessageUseCase interface {
	CreateMessage(channelID, userID uuid.UUID, content string) (*Message, error)
	GetMessages(channelID uuid.UUID, limit, offset int) ([]*Message, error)
}
```

на:

```go
type MessageUseCase interface {
	CreateMessage(channelID, userID uuid.UUID, content string) (*Message, error)
	GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*Message, error)
}
```

- [ ] **Step 4: Реализовать проверку членства в usecase**

Заменить весь `server/internal/usecase/message.go` на:

```go
package usecase

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type messageUseCase struct {
	messageRepo domain.MessageRepository
	channelRepo domain.ChannelRepository
	serverRepo  domain.ServerRepository
}

func NewMessageUseCase(
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
	serverRepo domain.ServerRepository,
) domain.MessageUseCase {
	return &messageUseCase{
		messageRepo: messageRepo,
		channelRepo: channelRepo,
		serverRepo:  serverRepo,
	}
}

// requireMembership проверяет, что канал существует и пользователь состоит в его
// сервере. Возвращает domain.ErrChannelNotFound (обёрнуто) или domain.ErrForbidden.
func (uc *messageUseCase) requireMembership(channelID, userID uuid.UUID) error {
	ch, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return fmt.Errorf("get channel: %w", err)
	}

	isMember, err := uc.serverRepo.IsMember(ch.ServerID, userID)
	if err != nil {
		return fmt.Errorf("check membership: %w", err)
	}
	if !isMember {
		return domain.ErrForbidden
	}
	return nil
}

func (uc *messageUseCase) CreateMessage(channelID, userID uuid.UUID, content string) (*domain.Message, error) {
	if err := uc.requireMembership(channelID, userID); err != nil {
		return nil, err
	}

	now := time.Now()
	msg := &domain.Message{
		ID:        uuid.New(),
		ChannelID: channelID,
		UserID:    userID,
		Content:   content,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.messageRepo.Create(msg); err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	return msg, nil
}

func (uc *messageUseCase) GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*domain.Message, error) {
	if err := uc.requireMembership(channelID, userID); err != nil {
		return nil, err
	}

	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	messages, err := uc.messageRepo.GetByChannelID(channelID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages: %w", err)
	}

	return messages, nil
}
```

- [ ] **Step 5: Запустить usecase-тесты — должны пройти**

Run: `cd server && go test ./internal/usecase/ -run 'TestCreateMessage|TestGetMessages' -v`
Expected: PASS (5 тестов). `go build ./...` пока может падать — хендлер и main ещё используют старую сигнатуру `GetMessages`. Это чиним в шагах 6-8.

- [ ] **Step 6: Обновить хендлер сообщений — userID + маппинг ошибок**

Заменить весь `server/internal/delivery/http/handler/message.go` на:

```go
package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type MessageHandler struct {
	messageUseCase domain.MessageUseCase
	hub            *ws.Hub
	log            *slog.Logger
}

func NewMessageHandler(messageUseCase domain.MessageUseCase, hub *ws.Hub, log *slog.Logger) *MessageHandler {
	return &MessageHandler{
		messageUseCase: messageUseCase,
		hub:            hub,
		log:            log,
	}
}

type CreateMessageRequest struct {
	Content string `json:"content"`
}

func (h *MessageHandler) CreateMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelIDStr := r.PathValue("channel_id")
	channelID, err := uuid.Parse(channelIDStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	var req CreateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Content == "" {
		h.sendError(w, http.StatusBadRequest, "message content is required")
		return
	}

	msg, err := h.messageUseCase.CreateMessage(channelID, userID, req.Content)
	if err != nil {
		h.writeUseCaseError(w, err)
		return
	}

	// Broadcast to all clients currently viewing this channel
	payload, _ := json.Marshal(msg)
	h.hub.SendToChannel(channelID, &ws.Message{
		Type:    "chat_message",
		Payload: payload,
	})

	h.sendJSON(w, http.StatusCreated, msg)
}

func (h *MessageHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelIDStr := r.PathValue("channel_id")
	channelID, err := uuid.Parse(channelIDStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

	if limit <= 0 {
		limit = 50
	}

	messages, err := h.messageUseCase.GetMessages(channelID, userID, limit, offset)
	if err != nil {
		h.writeUseCaseError(w, err)
		return
	}

	if messages == nil {
		messages = []*domain.Message{}
	}

	h.sendJSON(w, http.StatusOK, messages)
}

// writeUseCaseError транслирует доменные ошибки в HTTP-статусы, не раскрывая
// внутренние детали (err.Error()) наружу.
func (h *MessageHandler) writeUseCaseError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrChannelNotFound):
		h.sendError(w, http.StatusNotFound, "channel not found")
	case errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, "access denied")
	default:
		h.log.Error("message request failed", "error", err)
		h.sendError(w, http.StatusInternalServerError, "internal server error")
	}
}

func (h *MessageHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *MessageHandler) sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
```

- [ ] **Step 7: Обновить сборку usecase в main.go**

В `server/cmd/api/main.go` строка 80 заменить:

```go
	messageUseCase := usecase.NewMessageUseCase(messageRepo, channelRepo)
```

на:

```go
	messageUseCase := usecase.NewMessageUseCase(messageRepo, channelRepo, serverRepo)
```

(`serverRepo` уже объявлен на строке 71.)

- [ ] **Step 8: Полная проверка сборки и тестов**

Run: `cd server && go build ./... && go vet ./... && go test ./...`
Expected: сборка успешна; все тесты PASS, включая новые `internal/usecase` (5 кейсов) и существующие.

- [ ] **Step 9: Commit**

```bash
cd server && git add internal/domain/usecase.go internal/usecase/message.go internal/usecase/message_test.go internal/delivery/http/handler/message.go cmd/api/main.go
git commit -m "VYC-27 Проверка членства при чтении/отправке сообщений (403/404)"
```

---

## Self-Review

**Spec coverage:**
- 403 не-участнику → Task 2 (`ErrForbidden`, `writeUseCaseError`). ✔
- 404 несуществующий канал → Task 1 (репо) + Task 2 (маппинг). ✔
- Проверка в usecase через `IsMember` → Task 2 (`requireMembership`). ✔
- `GetMessages` получает `userID` → Task 2, шаги 3-4. ✔
- Убрать утечку `err.Error()` → Task 2, `writeUseCaseError` (default → общий текст + лог). ✔
- Фикс `sql.ErrNoRows`→`pgx.ErrNoRows` → Task 1. ✔
- Unit-тесты usecase (member/not-member/channel-not-found для обоих методов) → Task 2, шаг 1. ✔
- Сообщение не создаётся при отказе / broadcast не идёт → гарантируется порядком в `CreateMessage` (проверка до `Create`), тест `TestCreateMessage_NotMember_Forbidden` (`AssertNotCalled Create`). ✔

**Placeholder scan:** плейсхолдеров/TODO/«обработать ошибки» нет — весь код приведён целиком.

**Type consistency:** `NewMessageUseCase(3 арг)`, `GetMessages(channelID, userID, limit, offset)`, `requireMembership(channelID, userID)`, `writeUseCaseError(w, err)`, `domain.ErrForbidden`/`domain.ErrChannelNotFound` — согласованы между интерфейсом, реализацией, тестами, хендлером и main.
