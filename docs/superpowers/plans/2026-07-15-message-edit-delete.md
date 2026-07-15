# Редактирование и удаление сообщений — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать автору сообщения редактировать и удалять свои сообщения (REST + WS-синхронизация между клиентами), согласно спеке `docs/superpowers/specs/2026-07-15-message-edit-delete-design.md`.

**Architecture:** Clean architecture слой за слоем: repository (уже готов) → usecase (`UpdateMessage`/`DeleteMessage` с проверкой автора) → HTTP handler (`PATCH`/`DELETE`) → WS broadcast (`message_update`/`message_delete` через существующий `hub.SendToChannel`) → клиент (api.ts → messageStore → ChatArea UI).

**Tech Stack:** Go 1.x (net/http, pgx/v5, testify/mock), React + TypeScript + zustand, нативный WebSocket-клиент.

## Global Constraints

- Только автор сообщения может редактировать/удалять — без ролей admin/owner, без ограничения по времени.
- Удаление — hard delete (`DELETE FROM messages`), без `deleted_at`.
- `user_id` для авторизации действия всегда берётся из JWT-контекста (`r.Context().Value("user_id")`), никогда из тела запроса.
- Имена WS-событий строго `message_update` и `message_delete` (как в борде).
- Редактирование содержимого без изменений — не должно бить в БД и не должно публиковать WS-событие.
- Нет unit-test инфраструктуры на клиенте (React/zustand) — фронтенд-задачи проверяются вручную через dev-сервер, не автотестами. Repository-слой на Go тоже без прямых unit-тестов (см. прецедент в `docs/superpowers/specs/2026-07-09-channel-membership-check-design.md`) — доменная ошибка проверяется через мок в usecase-тестах.

---

### Task 1: Repository — исправить определение "не найдено" в `messageRepository.GetByID`

**Проблема:** `internal/repository/postgres/message.go:73` проверяет `err == sql.ErrNoRows`, но пул — `pgx/v5` (`pgxpool.Pool`), который на отсутствие строки возвращает `pgx.ErrNoRows`, а не `database/sql.ErrNoRows`. Условие никогда не срабатывает — несуществующее сообщение сейчас падает в общую ветку `"failed to get message: %w"`. Тот же баг был в `channel.go` до фикса VYC-27 (`internal/repository/postgres/channel.go:74-76`). Это нужно исправить **до** Task 2/3, иначе `usecase.UpdateMessage`/`DeleteMessage` не смогут отличить "сообщение не найдено" от прочих ошибок БД через `errors.Is`.

**Files:**
- Modify: `server/internal/repository/postgres/message.go:1-13` (imports), `:52-81` (`GetByID`)

**Interfaces:**
- Produces: `messageRepository.GetByID` возвращает ошибку, оборачивающую `domain.ErrMessageNotFound` (новый сентинел из Task 2) при отсутствии строки — используется в Task 2/3.

- [ ] **Step 1: Заменить импорты**

В `server/internal/repository/postgres/message.go` заменить блок импортов:

```go
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

(было: `"database/sql"` вместо `"errors"` + `"github.com/jackc/pgx/v5"`).

- [ ] **Step 2: Исправить `GetByID`**

Заменить тело `GetByID` (было `if err == sql.ErrNoRows { return nil, fmt.Errorf("message not found") }`) на:

```go
func (r *messageRepository) GetByID(id uuid.UUID) (*domain.Message, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, channel_id, user_id, content, attachments, created_at, updated_at
		FROM messages
		WHERE id = $1
	`

	msg := &domain.Message{}
	err := r.db.QueryRow(ctx, query, id).Scan(
		&msg.ID,
		&msg.ChannelID,
		&msg.UserID,
		&msg.Content,
		&msg.Attachments,
		&msg.CreatedAt,
		&msg.UpdatedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("message %s: %w", id, domain.ErrMessageNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get message: %w", err)
	}

	return msg, nil
}
```

Это ссылается на `domain.ErrMessageNotFound`, которого пока нет — временно код не скомпилируется, это нормально: сентинел добавляется в Task 2, Step 1, до `go build`.

- [ ] **Step 3: Отложенная сборка**

Не запускать `go build` после этого шага в одиночку (упадёт из-за отсутствующего `domain.ErrMessageNotFound`) — собрать вместе с Task 2, Step 2.

- [ ] **Step 4: Коммит вместе с Task 2**

Коммит этого изменения делается одним коммитом с Task 2 (см. Task 2, Step 5), т.к. по отдельности код не компилируется.

---

### Task 2: Usecase — `UpdateMessage`

**Files:**
- Modify: `server/internal/domain/errors.go`
- Modify: `server/internal/domain/usecase.go:30-33`
- Modify: `server/internal/usecase/message.go`
- Test: `server/internal/usecase/message_test.go`

**Interfaces:**
- Consumes: `messageRepo.GetByID(id uuid.UUID) (*domain.Message, error)`, `messageRepo.Update(id uuid.UUID, updates map[string]interface{}) error` (уже существуют, `internal/domain/message.go:19-25`); `uc.requireMembership(channelID, userID uuid.UUID) error` (существует, `internal/usecase/message.go:31-55`).
- Produces: `domain.ErrMessageNotFound` сентинел (используется в Task 3, Task 4); `MessageUseCase.UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*domain.Message, error)` (используется в Task 4 — HTTP handler).

- [ ] **Step 1: Добавить сентинел `ErrMessageNotFound`**

`server/internal/domain/errors.go` — добавить в блок `var`:

```go
package domain

import "errors"

// Доменные сентинел-ошибки. Хендлеры транслируют их в HTTP-статусы через errors.Is.
var (
	// ErrForbidden — пользователь не участник сервера, доступ запрещён.
	ErrForbidden = errors.New("access denied")
	// ErrChannelNotFound — канал с указанным ID не существует.
	ErrChannelNotFound = errors.New("channel not found")
	// ErrMessageNotFound — сообщение с указанным ID не существует или не принадлежит каналу из URL.
	ErrMessageNotFound = errors.New("message not found")
)
```

- [ ] **Step 2: Расширить `MessageUseCase` интерфейс (только `UpdateMessage`)**

`server/internal/domain/usecase.go:30-33` — заменить:

```go
type MessageUseCase interface {
	CreateMessage(channelID, userID uuid.UUID, content string) (*Message, error)
	GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*Message, error)
	UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*Message, error)
}
```

`DeleteMessage` в интерфейс пока **не** добавляется — это часть Task 3 (там же добавляется её реализация в том же коммите, чтобы `go build` не ломался между тасками). Это временно сломает сборку (`messageUseCase` из `internal/usecase` больше не реализует интерфейс, не хватает `UpdateMessage`) — нормально, реализация добавляется в Step 4 этого таска.

- [ ] **Step 3: Написать падающие тесты для `UpdateMessage`**

Добавить в конец `server/internal/usecase/message_test.go`:

```go
func TestUpdateMessage_Author_ContentChanged_Success(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)
	msgRepo.On("Update", messageID, map[string]interface{}{"content": "new"}).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", msg.Content)
	msgRepo.AssertCalled(t, "Update", messageID, map[string]interface{}{"content": "new"})
}

func TestUpdateMessage_ContentUnchanged_NoOp(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "same"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "same")

	assert.NoError(t, err)
	assert.Equal(t, "same", msg.Content)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateMessage_NotAuthor_Forbidden(t *testing.T) {
	channelID, serverID, userID, authorID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: authorID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateMessage_MessageNotFound(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("GetByID", messageID).Return(nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
}

func TestUpdateMessage_WrongChannel_NotFound(t *testing.T) {
	channelID, otherChannelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: otherChannelID, UserID: userID, Content: "old"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
	msgRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateMessage_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	msg, err := uc.UpdateMessage(channelID, messageID, userID, "new")

	assert.Nil(t, msg)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}
```

Run: `cd server && go vet ./...`
Expected: FAIL — `messageUseCase` (и мок в тесте) не реализуют `UpdateMessage`, компиляция падает (`uc.UpdateMessage undefined`).

- [ ] **Step 4: Реализовать `UpdateMessage`**

Добавить в `server/internal/usecase/message.go` (после `GetMessages`):

```go
func (uc *messageUseCase) UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*domain.Message, error) {
	if err := uc.requireMembership(channelID, userID); err != nil {
		return nil, err
	}

	msg, err := uc.messageRepo.GetByID(messageID)
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}
	if msg.ChannelID != channelID {
		return nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}
	if msg.UserID != userID {
		return nil, domain.ErrForbidden
	}

	if msg.Content == content {
		return msg, nil
	}

	if err := uc.messageRepo.Update(messageID, map[string]interface{}{"content": content}); err != nil {
		return nil, fmt.Errorf("failed to update message: %w", err)
	}

	msg.Content = content
	msg.UpdatedAt = time.Now()
	return msg, nil
}
```

`time` уже импортирован в этом файле (используется в `CreateMessage`).

- [ ] **Step 5: Запустить тесты, собрать проект, закоммитить**

Run: `cd server && go test ./internal/usecase/... -run TestUpdateMessage -v`
Expected: все 6 тестов PASS.

Run: `cd server && go build ./...`
Expected: успешная сборка (это также подтверждает фикс из Task 1, Step 2 — `domain.ErrMessageNotFound` теперь существует и используется).

```bash
git add server/internal/domain/errors.go server/internal/domain/usecase.go \
        server/internal/usecase/message.go server/internal/usecase/message_test.go \
        server/internal/repository/postgres/message.go
git commit -m "feat(messages): usecase UpdateMessage + fix pgx.ErrNoRows detection in GetByID"
```

---

### Task 3: Usecase — `DeleteMessage`

**Files:**
- Modify: `server/internal/usecase/message.go`
- Test: `server/internal/usecase/message_test.go`

**Interfaces:**
- Consumes: `messageRepo.GetByID`, `messageRepo.Delete(id uuid.UUID) error` (существует), `uc.requireMembership` — все из Task 2/существующего кода.
- Produces: `MessageUseCase.DeleteMessage(channelID, messageID, userID uuid.UUID) error` — используется в Task 4.

- [ ] **Step 1: Расширить `MessageUseCase` интерфейс — добавить `DeleteMessage`**

`server/internal/domain/usecase.go:30-34` — заменить:

```go
type MessageUseCase interface {
	CreateMessage(channelID, userID uuid.UUID, content string) (*Message, error)
	GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*Message, error)
	UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*Message, error)
	DeleteMessage(channelID, messageID, userID uuid.UUID) error
}
```

Это временно сломает сборку (`messageUseCase` не реализует `DeleteMessage`) — исправляется в Step 3 этого таска.

- [ ] **Step 2: Написать падающие тесты**

Добавить в конец `server/internal/usecase/message_test.go`:

```go
func TestDeleteMessage_Author_Success(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: userID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)
	msgRepo.On("Delete", messageID).Return(nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.NoError(t, err)
	msgRepo.AssertCalled(t, "Delete", messageID)
}

func TestDeleteMessage_NotAuthor_Forbidden(t *testing.T) {
	channelID, serverID, userID, authorID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: channelID, UserID: authorID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteMessage_MessageNotFound(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	msgRepo.On("GetByID", messageID).Return(nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
}

func TestDeleteMessage_WrongChannel_NotFound(t *testing.T) {
	channelID, otherChannelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(true, nil)
	existing := &domain.Message{ID: messageID, ChannelID: otherChannelID, UserID: userID, Content: "bye"}
	msgRepo.On("GetByID", messageID).Return(existing, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
	msgRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteMessage_NotMember_Forbidden(t *testing.T) {
	channelID, serverID, userID, messageID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	msgRepo := new(MockMessageRepository)
	chRepo := new(MockChannelRepository)
	srvRepo := new(MockServerRepository)

	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: uuid.New()}, nil)
	srvRepo.On("IsMember", serverID, userID).Return(false, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, srvRepo)
	err := uc.DeleteMessage(channelID, messageID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	msgRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}
```

Run: `cd server && go vet ./...`
Expected: FAIL — `uc.DeleteMessage undefined`.

- [ ] **Step 3: Реализовать `DeleteMessage`**

Добавить в `server/internal/usecase/message.go` (после `UpdateMessage`):

```go
func (uc *messageUseCase) DeleteMessage(channelID, messageID, userID uuid.UUID) error {
	if err := uc.requireMembership(channelID, userID); err != nil {
		return err
	}

	msg, err := uc.messageRepo.GetByID(messageID)
	if err != nil {
		return fmt.Errorf("get message: %w", err)
	}
	if msg.ChannelID != channelID {
		return fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}
	if msg.UserID != userID {
		return domain.ErrForbidden
	}

	if err := uc.messageRepo.Delete(messageID); err != nil {
		return fmt.Errorf("failed to delete message: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: Запустить тесты, собрать проект, закоммитить**

Run: `cd server && go test ./internal/usecase/... -v`
Expected: все тесты пакета (старые + новые Update/Delete) PASS.

Run: `cd server && go build ./...`
Expected: успешная сборка.

```bash
git add server/internal/domain/usecase.go server/internal/usecase/message.go server/internal/usecase/message_test.go
git commit -m "feat(messages): usecase DeleteMessage"
```

---

### Task 4: HTTP handler — роуты `PATCH`/`DELETE` + WS-broadcast `message_update`/`message_delete`

**Files:**
- Modify: `server/internal/delivery/http/handler/message.go`
- Modify: `server/cmd/api/main.go:126-128`

**Interfaces:**
- Consumes: `domain.MessageUseCase.UpdateMessage`/`DeleteMessage` (Task 2/3); `ws.Hub.SendToChannel(channelID uuid.UUID, message *ws.Message)` (существует, `internal/delivery/ws/hub.go:204`); `ws.Message{Type string, Payload json.RawMessage}` (существует, `internal/delivery/ws/hub.go:21-24`).
- Produces: HTTP `PATCH/DELETE /api/v1/channels/{channel_id}/messages/{message_id}`; WS-события `message_update` (payload — `domain.Message` JSON) и `message_delete` (payload — `{"id":"...","channel_id":"..."}`) — используются в Task 5-7 (клиент).

- [ ] **Step 1: Добавить `UpdateMessage`/`DeleteMessage` в handler + расширить `writeUseCaseError`**

В `server/internal/delivery/http/handler/message.go` добавить после `CreateMessage` (после строки 68) новый тип запроса и два метода:

```go
type UpdateMessageRequest struct {
	Content string `json:"content"`
}

func (h *MessageHandler) UpdateMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}
	messageID, err := uuid.Parse(r.PathValue("message_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid message id")
		return
	}

	var req UpdateMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Content == "" {
		h.sendError(w, http.StatusBadRequest, "message content is required")
		return
	}

	msg, err := h.messageUseCase.UpdateMessage(channelID, messageID, userID, req.Content)
	if err != nil {
		h.writeUseCaseError(w, err)
		return
	}

	payload, _ := json.Marshal(msg)
	h.hub.SendToChannel(channelID, &ws.Message{
		Type:    "message_update",
		Payload: payload,
	})

	h.sendJSON(w, http.StatusOK, msg)
}

type deleteMessagePayload struct {
	ID        uuid.UUID `json:"id"`
	ChannelID uuid.UUID `json:"channel_id"`
}

func (h *MessageHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}
	messageID, err := uuid.Parse(r.PathValue("message_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid message id")
		return
	}

	if err := h.messageUseCase.DeleteMessage(channelID, messageID, userID); err != nil {
		h.writeUseCaseError(w, err)
		return
	}

	payload, _ := json.Marshal(deleteMessagePayload{ID: messageID, ChannelID: channelID})
	h.hub.SendToChannel(channelID, &ws.Message{
		Type:    "message_delete",
		Payload: payload,
	})

	w.WriteHeader(http.StatusNoContent)
}
```

Затем изменить `writeUseCaseError` (строки 102-112), добавив кейс для `ErrMessageNotFound`:

```go
func (h *MessageHandler) writeUseCaseError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrChannelNotFound):
		h.sendError(w, http.StatusNotFound, "channel not found")
	case errors.Is(err, domain.ErrMessageNotFound):
		h.sendError(w, http.StatusNotFound, "message not found")
	case errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, "access denied")
	default:
		h.log.Error("message request failed", "error", err)
		h.sendError(w, http.StatusInternalServerError, "internal server error")
	}
}
```

- [ ] **Step 2: Зарегистрировать роуты**

В `server/cmd/api/main.go`, сразу после строки 128 (`GET .../messages`), добавить:

```go
router.HandleFunc("PATCH /api/v1/channels/{channel_id}/messages/{message_id}", authMid.RequireAuth(messageHandler.UpdateMessage))
router.HandleFunc("DELETE /api/v1/channels/{channel_id}/messages/{message_id}", authMid.RequireAuth(messageHandler.DeleteMessage))
```

- [ ] **Step 3: Собрать проект**

Run: `cd server && go build ./... && go vet ./...`
Expected: успешно, без ошибок. (У этого handler'а нет unit-тестов и в текущем коде — `CreateMessage`/`GetMessages` тоже не покрыты на уровне handler, вся логика уже верифицирована usecase-тестами из Task 2/3.)

- [ ] **Step 4: Коммит**

```bash
git add server/internal/delivery/http/handler/message.go server/cmd/api/main.go
git commit -m "feat(messages): PATCH/DELETE endpoints + message_update/message_delete WS broadcast"
```

---

### Task 5: Клиент — `api.ts`: `updateMessage`/`deleteMessage`

**Files:**
- Modify: `client/src/services/api.ts:126-136`

**Interfaces:**
- Consumes: `ApiService.request<T>(endpoint, options)` (существует, `client/src/services/api.ts:22-51`).
- Produces: `apiService.updateMessage(channelId: string, messageId: string, content: string): Promise<Message>`, `apiService.deleteMessage(channelId: string, messageId: string): Promise<void>` — используются в Task 7.

- [ ] **Step 1: Добавить методы**

В `client/src/services/api.ts`, сразу после `getMessages` (после строки 135):

```ts
  async updateMessage(channelId: string, messageId: string, content: string) {
    return this.request(`/api/v1/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
  }

  async deleteMessage(channelId: string, messageId: string) {
    return this.request(`/api/v1/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
    });
  }
```

- [ ] **Step 2: Типчек**

Run: `cd client && npx tsc --noEmit`
Expected: без новых ошибок (используется generic `request` без явного типа — как у существующих `createMessage`/`getMessages`, консистентно с текущим стилем файла).

- [ ] **Step 3: Коммит**

```bash
git add client/src/services/api.ts
git commit -m "feat(messages): api client methods for update/delete"
```

---

### Task 6: Клиент — `messageStore.ts`: `updateMessage`/`removeMessage`

**Files:**
- Modify: `client/src/stores/messageStore.ts`

**Interfaces:**
- Produces: `useMessageStore().updateMessage(id: string, patch: Partial<Message>): void`, `useMessageStore().removeMessage(id: string): void` — используются в Task 7.

- [ ] **Step 1: Расширить store**

Заменить содержимое `client/src/stores/messageStore.ts` на:

```ts
import { create } from 'zustand';
import type { Message } from '@/types';

interface MessageState {
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, patch: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],

  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id) })),
  clearMessages: () => set({ messages: [] }),
}));
```

- [ ] **Step 2: Типчек**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add client/src/stores/messageStore.ts
git commit -m "feat(messages): store actions updateMessage/removeMessage"
```

---

### Task 7: Клиент — `ChatArea.tsx`: hover-действия, inline-редактирование, confirm на удаление, пометка «изменено», WS-подписки

**Files:**
- Modify: `client/src/components/ChatArea.tsx`
- Modify: `client/src/components/ChatArea.css`

**Interfaces:**
- Consumes: `apiService.updateMessage`/`deleteMessage` (Task 5), `useMessageStore().updateMessage`/`removeMessage` (Task 6), `wsService.on(eventType: string, listener: (payload: unknown) => void): () => void` (существует, `client/src/services/websocket.ts:125-135`).
- Produces: конечный UI — работающее редактирование/удаление своих сообщений в чате.

- [ ] **Step 1: Добавить WS-подписки на `message_update`/`message_delete`**

В `client/src/components/ChatArea.tsx` добавить `type KeyboardEvent` в импорт из `react` (строка 1, нужен для Step 2 — файл использует именованные импорты, без глобального `React`, поэтому `React.KeyboardEvent` не соберётся):

```tsx
import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
```

Добавить `updateMessage`, `removeMessage` в деструктуризацию стора (строка 18) и новый `useEffect` рядом с существующей подпиской на `chat_message` (после блока строк 66-92):

```tsx
  const { messages, addMessage, updateMessage, removeMessage } = useMessageStore();
```

```tsx
  useEffect(() => {
    const unsubUpdate = wsService.on('message_update', (payload) => {
      const msg = payload as Message;
      updateMessage(msg.id, msg);
    });
    const unsubDelete = wsService.on('message_delete', (payload) => {
      const { id } = payload as { id: string; channel_id: string };
      removeMessage(id);
    });
    return () => {
      unsubUpdate();
      unsubDelete();
    };
  }, [updateMessage, removeMessage]);
```

- [ ] **Step 2: Добавить состояние редактирования и обработчики**

После `handleSubmit` (после строки 109) добавить:

```tsx
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditValue(msg.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue('');
  };

  const saveEdit = async (messageId: string) => {
    if (!channel || !editValue.trim()) return;
    try {
      const updated = await apiService.updateMessage(channel.id, messageId, editValue.trim()) as Message;
      updateMessage(messageId, updated);
      cancelEdit();
    } catch (err) {
      console.error('Failed to update message:', err);
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLInputElement>, messageId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(messageId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleDelete = async (messageId: string) => {
    if (!channel) return;
    if (!window.confirm('Удалить сообщение?')) return;
    try {
      await apiService.deleteMessage(channel.id, messageId);
      removeMessage(messageId);
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
  };
```

- [ ] **Step 3: Обновить рендер сообщения — hover-иконки, inline-редактирование, пометка «изменено»**

Заменить блок рендера одного сообщения (строки 172-207) на:

```tsx
              const isEdited = msg.updated_at !== msg.created_at;
              const isEditing = editingId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`message ${isCompact ? 'compact' : ''} ${isFromMe ? 'self' : 'other'}`}
                >
                  {!isCompact && !isFromMe && (
                    <div className="message-avatar">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="message-content">
                    {!isCompact && !isFromMe && (
                      <div className="message-header">
                        <span className="message-author">{displayName}</span>
                        <span className="message-timestamp">
                          {formatTime(msg.created_at)}
                          {isEdited && ' (изменено)'}
                        </span>
                      </div>
                    )}
                    {!isCompact && isFromMe && (
                      <div className="message-header self">
                        <span className="message-timestamp">
                          {formatTime(msg.created_at)}
                          {isEdited && ' (изменено)'}
                        </span>
                        <span className="message-author">{displayName}</span>
                      </div>
                    )}
                    {isEditing ? (
                      <input
                        className="message-edit-input"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => handleEditKeyDown(e, msg.id)}
                        onBlur={cancelEdit}
                        maxLength={2000}
                        autoFocus
                      />
                    ) : (
                      <p className="message-text">{msg.content}</p>
                    )}
                  </div>
                  {!isCompact && isFromMe && (
                    <div className="message-avatar self">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {isFromMe && !isEditing && (
                    <div className="message-actions">
                      <button
                        type="button"
                        className="message-action-btn"
                        aria-label="Edit"
                        onClick={() => startEdit(msg)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                      </button>
                      <button
                        type="button"
                        className="message-action-btn message-action-btn--danger"
                        aria-label="Delete"
                        onClick={() => handleDelete(msg.id)}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </div>
                  )}
                </div>
              );
```

Заменить `{messages.map((msg, idx) => {` (строка 159) — оставить как есть, только вставленный код заменяет тело после вычисления `displayName` (было `return (` на строке 172 и далее).

- [ ] **Step 4: CSS для hover-действий и inline-инпута**

В `client/src/components/ChatArea.css`, после блока `.message-avatar.self` (после строки 206), добавить:

```css
/* ── Message hover actions ── */
.message {
  position: relative;
}

.message-actions {
  display: none;
  position: absolute;
  top: -14px;
  gap: 2px;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  padding: 2px;
}

.message.self .message-actions {
  right: 54px;
}

.message.other .message-actions {
  left: 54px;
}

.message:hover .message-actions {
  display: flex;
}

.message-action-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition);
}

.message-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.message-action-btn--danger:hover {
  background: var(--red-500);
  color: white;
}

.message-edit-input {
  width: 100%;
  padding: 8px 14px;
  border: 1.5px solid var(--brand-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}
```

- [ ] **Step 5: Типчек и ручная проверка**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок.

Ручная проверка (dev-сервер): запустить клиент (`npm run dev:vite` или используемый в проекте способ запуска), открыть канал, отправить сообщение, навести курсор — должны появиться иконки карандаш/корзина; карандаш → инлайн-редактирование (Enter сохраняет, Esc отменяет); корзина → confirm → сообщение исчезает из ленты.

- [ ] **Step 6: Коммит**

```bash
git add client/src/components/ChatArea.tsx client/src/components/ChatArea.css
git commit -m "feat(messages): edit/delete UI — hover actions, inline edit, edited marker"
```

---

### Task 8: Сквозная проверка (два клиента)

**Files:** нет изменений — только проверка.

- [ ] **Step 1: Поднять backend и клиент**

Запустить сервер (`cd server && go run cmd/api/main.go` либо принятый в проекте способ через Makefile) и клиент (`cd client && npm run dev:vite`), подключённые к одной БД.

- [ ] **Step 2: Открыть один канал в двух вкладках/окнах под одним аккаунтом**

- Отправить сообщение из вкладки A.
- В обеих вкладках навести на сообщение — иконки видны только там, где `user_id === текущий пользователь`.
- Отредактировать сообщение во вкладке A → во вкладке B текст и пометка «(изменено)» должны обновиться без перезагрузки (через `message_update`).
- Удалить сообщение во вкладке A (через confirm) → во вкладке B сообщение должно исчезнуть (через `message_delete`).

- [ ] **Step 3: Проверить запреты**

Через `curl` с валидным JWT второго пользователя (не автора) попытаться `PATCH`/`DELETE` чужое сообщение — ожидается `403 {"error":"access denied"}`. Запрос с несуществующим `message_id` — `404 {"error":"message not found"}`.

- [ ] **Step 4: Финальный прогон тестов**

Run: `cd server && go test ./... `
Expected: все тесты PASS.

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок.

Никакого коммита на этом шаге — задача чисто верификационная.
