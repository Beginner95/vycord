# Отправка эмодзи и стикеров — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать пользователям Vycord отправлять стандартные Unicode-эмодзи (из пикера с категориями) и серверные стикеры (сообщение-картинка), которые загружают владелец и администраторы.

**Architecture:** Стикеры хранятся в новой таблице `stickers` (server_id, name, image_url); сами файлы кладутся в уже существующее локальное файловое хранилище `filestorage` (UPLOAD_DIR), как аватары. Сообщение-стикер — это расширение существующего `POST /messages` на опциональное поле `sticker_id`; content остаётся строкой и для стикер-сообщения заполняется пустой строкой. Клиент: самописные попап-пикеры эмодзи (только клиентская логика, символы вставляются в textarea) и стикеров (грид картинок сервера), иконки рядом с «Маркированным списком».

**Tech Stack:** Go 1.22+ (net/http ServeMux, pgx, jackc), UUID (google/uuid), testify для тестов, React 19 + TypeScript (zustand, vitest), уже есть `filestorage` пакет.

## Global Constraints

- Битовая маска прав зафиксирована (см. `domain/permission.go`) — новые права **не** вводим. Управление стикерами использует существующее `PermManageServer` (= 1<<1).
- **`Message.Content` остаётся типом `string` (НЕ указатель).** Стикер-сообщение хранит `content = ""` (пустая не-null строка) + `sticker_id`. Колонка `messages.content` остаётся `NOT NULL`. Рендер и логика строятся на присутствии `sticker_id`, а не на nullability `content`. На клиенте `Message.content: string` (не `string | null`).
- Менять существующие селекторы `messages` нельзя вслепую — они перечисляют колонки явно; при добавлении колонки `sticker_id` их нужно легитиматно расширить.
- `validateImage` из `usecase/image.go` поддерживает только PNG и JPEG, размеры 32–4096. Переиспользуем его для стикеров.
- i18n: ключи добавляются **в оба** файла `ru.ts` и `en.ts` (en.ts типизирован как `Dictionary` от ru.ts — иначе сборка TS упадёт).
- Иконки эмодзи/стикеров ставятся рядом с «Маркированным списком» и в режиме составления, и в режиме редактирования.
- Значения лимитов: аватар/иконка — `maxAvatarRequestBytes = 3<<20`, `maxAvatarFileBytes = 2<<20`. Для стикера используем те же лимиты.
- Все коммиты на ветке `VYC-69-stikers`.

---

### Task 1: Миграция `015_create_stickers`

**Files:**
- Create: `server/migrations/015_create_stickers.up.sql`
- Create: `server/migrations/015_create_stickers.down.sql`

**Interfaces:**
- Consumes: сущ. таблицы `servers`, `users`, `messages`.
- Produces: таблица `stickers(id, server_id, name, image_url, created_by, created_at)` и колонка `messages.sticker_id` (content остаётся NOT NULL).

- [ ] **Step 1: Создать up-миграцию**

`server/migrations/015_create_stickers.up.sql`:
```sql
-- +migrate Up
CREATE TABLE IF NOT EXISTS stickers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id  UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    image_url  TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stickers_server_id ON stickers(server_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES stickers(id) ON DELETE CASCADE;
-- +migrate Down
ALTER TABLE messages DROP COLUMN IF EXISTS sticker_id;
DROP TABLE IF EXISTS stickers;
```

- [ ] **Step 2: Создать down-миграцию**

`server/migrations/015_create_stickers.down.sql`:
```sql
-- +migrate Down
ALTER TABLE messages DROP COLUMN IF EXISTS sticker_id;
DROP TABLE IF EXISTS stickers;
```

- [ ] **Step 3: Прогнать миграцию локально**

Run: `make migrate-up`
Expected: применение миграции 015 без ошибок. Проверка: `make migrate-down && make migrate-up` — идемпотентность тоже без ошибок.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/015_create_stickers.up.sql server/migrations/015_create_stickers.down.sql
git commit -m "feat: add stickers table and messages.sticker_id migration"
```

---

### Task 2: Домен и sentinel-ошибки для стикеров

**Files:**
- Create: `server/internal/domain/sticker.go`
- Modify: `server/internal/domain/errors.go:45`

**Interfaces:**
- Consumes: `server.go` сущности, стандартную `uuid`.
- Produces:
  - `type Sticker struct { ID uuid.UUID \`json:"id"\`; ServerID uuid.UUID \`json:"server_id"\`; Name string \`json:"name"\`; ImageURL string \`json:"image_url"\`; CreatedBy uuid.UUID \`json:"created_by"\`; CreatedAt time.Time \`json:"created_at"\` }`
  - `type StickerRepository interface { Create(*Sticker) error; ListByServer(serverID uuid.UUID) ([]*Sticker, error); GetByID(id uuid.UUID) (*Sticker, error); Delete(id uuid.UUID) error }`
  - `ErrStickerNotFound`, `ErrStickerForbidden`, `ErrStickerNameRequired`, `ErrStickerNameTooLong`

- [ ] **Step 1: Написать failing test на ошибки**

Создать `server/internal/domain/sticker_test.go` (пакет `domain`) с тестом, что новые sentinel-ошибки не nil и отличимы:
```go
package domain

import "testing"

func TestStickerErrors(t *testing.T) {
	if ErrStickerNotFound == nil || ErrStickerForbidden == nil ||
		ErrStickerNameRequired == nil || ErrStickerNameTooLong == nil {
		t.Fatal("sticker sentinel errors must be defined")
	}
	if ErrStickerNotFound == ErrForbidden {
		t.Fatal("ErrStickerNotFound must differ from ErrForbidden")
	}
}
```

- [ ] **Step 2: Запустить тест — ожидается fail (нет типов)**

Run: `cd server && go test ./internal/domain/ -run TestStickerErrors`
Expected: FAIL — сборка не проходит ("undefined: ErrStickerNotFound").

- [ ] **Step 3: Реализовать sentinel-ошибки**

В `server/internal/domain/errors.go:45` (после `ErrInviteForbidden`) вставить:
```go
	// ErrStickerNotFound — стикер не существует или принадлежит другому серверу.
	ErrStickerNotFound = errors.New("sticker not found")
	// ErrStickerForbidden — у пользователя нет права управлять стикерами сервера.
	ErrStickerForbidden = errors.New("sticker access denied")
	// ErrStickerNameRequired — имя стикера пустое.
	ErrStickerNameRequired = errors.New("sticker name is required")
	// ErrStickerNameTooLong — имя стикера длиннее 100 символов.
	ErrStickerNameTooLong = errors.New("sticker name is too long")
```

- [ ] **Step 4: Создать доменную сущность**

`server/internal/domain/sticker.go`:
```go
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Sticker — серверный стикер: изображение, видимое всем участникам сервера.
type Sticker struct {
	ID        uuid.UUID `json:"id"`
	ServerID  uuid.UUID `json:"server_id"`
	Name      string    `json:"name"`
	ImageURL  string    `json:"image_url"`
	CreatedBy uuid.UUID `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

// StickerRepository — доступ к стикерам сервера.
type StickerRepository interface {
	Create(s *Sticker) error
	GetByID(id uuid.UUID) (*Sticker, error)
	ListByServer(serverID uuid.UUID) ([]*Sticker, error)
	Delete(id uuid.UUID) error
}
```

- [ ] **Step 5: Запустить доменные тесты**

Run: `cd server && go test ./internal/domain/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/internal/domain/sticker.go server/internal/domain/sticker_test.go server/internal/domain/errors.go
git commit -m "feat: add sticker domain entity, repository, and sentinel errors"
```

---

### Task 3: Расширить `Message` полем `sticker_id` и `sticker`

**Files:**
- Modify: `server/internal/domain/message.go:9-17`

**Interfaces:**
- Consumes: `Sticker` из Task 2.
- Produces: `Message.StickerID *uuid.UUID json:"sticker_id,omitempty"` и `Message.Sticker *Sticker json:"sticker,omitempty"`.

- [ ] **Step 1: Добавить поля в `domain.Message`**

`server/internal/domain/message.go`, заменить блок полей:
```go
type Message struct {
	ID          uuid.UUID  `json:"id"`
	ChannelID   uuid.UUID  `json:"channel_id"`
	UserID      uuid.UUID  `json:"user_id"`
	Content     string     `json:"content"`
	Attachments []string   `json:"attachments,omitempty"`
	StickerID   *uuid.UUID `json:"sticker_id,omitempty"`
	Sticker     *Sticker   `json:"sticker,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}
```

- [ ] **Step 2: Прогнать сборку и тесты**

`Content` остаётся `string` — существующие репозиторий/usecase/handler и их тесты не ломаются. Добавлены только `StickerID` (`*uuid.UUID`) и `Sticker` (`*Sticker`) — они нигде ещё не заполняются и в выводе `omitempty`.

- [ ] **Step 2: Прогнать сборку и тесты**

Run: `cd server && go test ./internal/domain/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/internal/domain/message.go
git commit -m "feat: add sticker_id and sticker fields to Message domain"
```

---

### Task 4: Postgres-репозиторий стикеров

**Files:**
- Create: `server/internal/repository/postgres/sticker.go`

**Interfaces:**
- Consumes: `domain.StickerRepository` (Task 2), `*pgxpool.Pool`.
- Produces: `func NewStickerRepository(db *pgxpool.Pool) domain.StickerRepository`.

- [ ] **Step 1: Написать failing test**

Создать `server/internal/repository/postgres/sticker_test.go` — репозиторий требует реальный Postgres. Вместо этого покрываем через usecase-level интеграцию на проде отсутствует. Для этого репозиторного слоя делаем compile-check тест, проверяющий, что `NewStickerRepository` возвращает интерфейс (без подключения к БД):

```go
package postgres_test

import (
	"testing"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
	"github.com/stretchr/testify/assert"
)

// NewStickerRepository требует *pgxpool.Pool — проверить можно только на этапе
// связывания. Здесь тест только на то, что конструктор существует и возвращает
// доменный интерфейс (компиляционная проверка).
func TestNewStickerRepositorySignature(t *testing.T) {
	var _ func(*pgxpool.Pool) domain.StickerRepository = postgres.NewStickerRepository
	assert.True(t, true)
}
```

Потребуется импорт `github.com/jackc/pgx/v5/pgxpool` — добавить в тест. Реализация с реальными запросами (Create/GetByID/ListByServer/Delete) — ниже.

- [ ] **Step 2: Запустить тест — ожидается fail (функция не определена)**

Run: `cd server && go test ./internal/repository/postgres/ -run TestNewStickerRepositorySignature`
Expected: FAIL — undefined: postgres.NewStickerRepository.

- [ ] **Step 3: Реализовать репозиторий**

`server/internal/repository/postgres/sticker.go`:
```go
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type stickerRepository struct {
	db *pgxpool.Pool
}

func NewStickerRepository(db *pgxpool.Pool) domain.StickerRepository {
	return &stickerRepository{db: db}
}

func (r *stickerRepository) Create(s *domain.Sticker) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO stickers (id, server_id, name, image_url, created_by, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`
	err := r.db.QueryRow(ctx, query, s.ID, s.ServerID, s.Name, s.ImageURL, s.CreatedBy, s.CreatedAt).Scan(&s.ID)
	if err != nil {
		return fmt.Errorf("failed to create sticker: %w", err)
	}
	return nil
}

func (r *stickerRepository) GetByID(id uuid.UUID) (*domain.Sticker, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `SELECT id, server_id, name, image_url, created_by, created_at FROM stickers WHERE id = $1`
	s := &domain.Sticker{}
	err := r.db.QueryRow(ctx, query, id).Scan(&s.ID, &s.ServerID, &s.Name, &s.ImageURL, &s.CreatedBy, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("sticker %s: %w", id, domain.ErrStickerNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get sticker: %w", err)
	}
	return s, nil
}

func (r *stickerRepository) ListByServer(serverID uuid.UUID) ([]*domain.Sticker, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `SELECT id, server_id, name, image_url, created_by, created_at FROM stickers WHERE server_id = $1 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, query, serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to list stickers: %w", err)
	}
	defer rows.Close()

	var stickers []*domain.Sticker
	for rows.Next() {
		s := &domain.Sticker{}
		if err := rows.Scan(&s.ID, &s.ServerID, &s.Name, &s.ImageURL, &s.CreatedBy, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan sticker: %w", err)
		}
		stickers = append(stickers, s)
	}
	return stickers, nil
}

func (r *stickerRepository) Delete(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `DELETE FROM stickers WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete sticker: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: Запустить тест — ожидается pass**

Run: `cd server && go test ./internal/repository/postgres/ -run TestNewStickerRepositorySignature`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/repository/postgres/sticker.go
git add server/internal/repository/postgres/sticker_test.go
git commit -m "feat: add postgres sticker repository"
```

---

### Task 5: Usecase стикеров

**Files:**
- Create: `server/internal/usecase/sticker.go`

**Interfaces:**
- Consumes: `domain.ServerRepository`, `domain.PermissionUseCase`, `domain.StickerRepository`, `filestorage.Storage`, `validateImage` (из `usecase/image.go`).
- Produces:
  - `func NewStickerUseCase(stickerRepo domain.StickerRepository, serverRepo domain.ServerRepository, perms domain.PermissionUseCase, storage filestorage.Storage) domain.StickerUseCase`
  - `domain.StickerUseCase { CreateSticker(...) (*Sticker, error); ListStickers(...) ([]*Sticker, error); DeleteSticker(...) error }` — интерфейс добавляется в `domain/usecase.go` (Step 3).

- [ ] **Step 1: Написать failing тест**

Создать `server/internal/usecase/sticker_test.go`. Переиспользовать моки `MockMessageRepository` нет — нужны `MockStickerRepository`, `MockServerRepository` (взять `MockServerRepository`, который уже есть в `message_test.go` или `server_test.go` того же пакета), `MockPermissionUseCase`. Схема моков по образцу `message_test.go`:

```go
package usecase_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type MockStickerRepository struct{ mock.Mock }

func (m *MockStickerRepository) Create(s *domain.Sticker) error {
	return m.Called(s).Error(0)
}
func (m *MockStickerRepository) GetByID(id uuid.UUID) (*domain.Sticker, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Sticker), args.Error(1)
}
func (m *MockStickerRepository) ListByServer(serverID uuid.UUID) ([]*domain.Sticker, error) {
	args := m.Called(serverID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Sticker), args.Error(1)
}
func (m *MockStickerRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}

type fakeStickerStorage struct{ returnedURL string }

func (f *fakeStickerStorage) Save(_ context.Context, _ string, _ interface{ Read([]byte) (int, error) }, _ string) (string, error) {
	return f.returnedURL, nil
}
func (f *fakeStickerStorage) Delete(_ context.Context, _ string) error { return nil }

func TestStickerUseCase_Create_Denied(t *testing.T) {
	perms := &MockPermissionUseCase{}
	perms.On("Resolve", mock.Anything, mock.Anything).Return(domain.PermissionSet{}, nil)

	uc := usecase.NewStickerUseCase(&MockStickerRepository{}, &MockServerRepository{}, perms, &fakeStickerStorage{})
	_, err := uc.CreateSticker(uuid.New(), uuid.New(), "x", nil, true)
	assert.ErrorIs(t, err, domain.ErrStickerForbidden)
}
```

**Важно:** сигнатура `AbstractStickerStorage` не существует в `filestorage` — реальный интерфейс: `Save(ctx, key string, r io.Reader, contentType string) (string, error)` и `Delete(ctx, url string) error`. Поэтому `fakeStickerStorage` должна использовать реальный `io.Reader`:

```go
type fakeStickerStorage struct{ returnedURL string }

func (f *fakeStickerStorage) Save(_ context.Context, _ string, _ io.Reader, _ string) (string, error) {
	return f.returnedURL, nil
}
func (f *fakeStickerStorage) Delete(_ context.Context, _ string) error { return nil }
```
(импорт `io`). Также `MockPermissionUseCase` и `MockServerRepository` уже определены в существующих тестах пакета `usecase_test` (в `message_test.go`, `server_test.go`) — если имя конфликтует, использовать те, что есть.

- [ ] **Step 2: Запустить тест — ожидается fail**

Run: `cd server && go test ./internal/usecase/ -run TestStickerUseCase_Create_Denied`
Expected: FAIL — undefined: usecase.NewStickerUseCase / domain.StickerUseCase.

- [ ] **Step 3: Добавить `StickerUseCase` в доменный интерфейс**

В `server/internal/domain/usecase.go` после `InviteUseCase` (или рядом с MessageUseCase) добавить:
```go
type StickerUseCase interface {
	// CreateSticker требует PermManageServer (владелец/админ).
	CreateSticker(serverID, userID uuid.UUID, name string, data []byte, isImageSet bool) (*Sticker, error)
	// ListStickers возвращает стикеры сервера (любому участнику).
	ListStickers(serverID, userID uuid.UUID) ([]*Sticker, error)
	// DeleteSticker требует PermManageServer.
	DeleteSticker(serverID, stickerID, userID uuid.UUID) error
}
```
Строка `imageData []byte` передаётся как `data`; `isImageSet` — признак того, что файл был приложен (для валидации в usecase). **Упрощение:** вместо `isImageSet` передаём `data []byte` и в usecase проверяем `len(data) == 0` → `ErrStickerNameRequired` не самая точная; корректнее отдельная ошибка. Для простоты примем сигнатуру:
```go
CreateSticker(serverID, userID uuid.UUID, name string, data []byte) (*Sticker, error)
```
и в usecase: `if len(data) == 0 { return nil, domain.ErrStickerImageRequired }` — добавить эту sentinel-ошибку в `errors.go` в Task 2. **Патч Task 2:** добавить `ErrStickerImageRequired`. Отмечаю здесь для связности.

- [ ] **Step 4: Реализовать usecase**

`server/internal/usecase/sticker.go`:
```go
package usecase

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)

type stickerUseCase struct {
	stickerRepo domain.StickerRepository
	serverRepo  domain.ServerRepository
	perms       domain.PermissionUseCase
	storage     filestorage.Storage
}

func NewStickerUseCase(
	stickerRepo domain.StickerRepository,
	serverRepo domain.ServerRepository,
	perms domain.PermissionUseCase,
	storage filestorage.Storage,
) domain.StickerUseCase {
	return &stickerUseCase{stickerRepo: stickerRepo, serverRepo: serverRepo, perms: perms, storage: storage}
}

func (uc *stickerUseCase) requireManage(serverID, userID uuid.UUID) error {
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return err
	}
	if !ps.Has(domain.PermManageServer) {
		return domain.ErrStickerForbidden
	}
	return nil
}

// validateStickerName проверяет имя: непустое, ≤100 символов.
func validateStickerName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return domain.ErrStickerNameRequired
	}
	if len([]rune(name)) > 100 {
		return domain.ErrStickerNameTooLong
	}
	return nil
}

func (uc *stickerUseCase) CreateSticker(serverID, userID uuid.UUID, name string, data []byte) (*domain.Sticker, error) {
	if _, err := uc.serverRepo.GetByID(serverID); err != nil {
		return nil, err
	}
	if err := uc.requireManage(serverID, userID); err != nil {
		return nil, err
	}
	if err := validateStickerName(name); err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, domain.ErrStickerImageRequired
	}

	ext, contentType, err := validateImage(data)
	if err != nil {
		return nil, err
	}

	key := fmt.Sprintf("stickers/%s/%s.%s", serverID, randomHex(8), ext)
	url, err := uc.storage.Save(context.Background(), key, bytes.NewReader(data), contentType)
	if err != nil {
		return nil, fmt.Errorf("save sticker: %w", err)
	}

	s := &domain.Sticker{
		ID:        uuid.New(),
		ServerID:  serverID,
		Name:      strings.TrimSpace(name),
		ImageURL:  url,
		CreatedBy: userID,
		CreatedAt: time.Now(),
	}
	if err := uc.stickerRepo.Create(s); err != nil {
		_ = uc.storage.Delete(context.Background(), url)
		return nil, err
	}
	return s, nil
}

func (uc *stickerUseCase) ListStickers(serverID, userID uuid.UUID) ([]*domain.Sticker, error) {
	// Чтение доступно только участникам — serverRepo.GetByID запрещает/разрешает?
	// Проверяем членство через Resolve (не-участник получает нулевой набор, но
	// список не приватный). Для простоты требуем PermViewChannels.
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(domain.PermViewChannels) {
		return nil, domain.ErrStickerForbidden
	}
	return uc.stickerRepo.ListByServer(serverID)
}

func (uc *stickerUseCase) DeleteSticker(serverID, stickerID, userID uuid.UUID) error {
	if err := uc.requireManage(serverID, userID); err != nil {
		return err
	}
	s, err := uc.stickerRepo.GetByID(stickerID)
	if err != nil {
		return err
	}
	if s.ServerID != serverID {
		return domain.ErrStickerNotFound
	}
	if err := uc.stickerRepo.Delete(stickerID); err != nil {
		return err
	}
	_ = uc.storage.Delete(context.Background(), s.ImageURL)
	return nil
}
```

- [ ] **Step 5: Запустить тесты — ожидается pass**

Run: `cd server && go test ./internal/usecase/`
Expected: PASS (новые тесты + существующие не сломаны).

- [ ] **Step 6: Commit**

```bash
git add server/internal/usecase/sticker.go server/internal/usecase/sticker_test.go server/internal/domain/usecase.go
git commit -m "feat: add sticker usecase with PermManageServer guard"
```

---

### Task 6: HTTP-хендлер стикеров + маршруты

**Files:**
- Create: `server/internal/delivery/http/handler/sticker.go`
- Modify: `server/cmd/api/main.go:116-146` (регистрация хендлера и маршрутов)

**Interfaces:**
- Consumes: `domain.StickerUseCase` (Task 5), `ws.Hub`, `slog.Logger`.
- Produces:
  - `func NewStickerHandler(uc domain.StickerUseCase, hub *ws.Hub, log *slog.Logger) *StickerHandler`
  - `(*StickerHandler).CreateSticker(w, r)`, `ListStickers(w, r)`, `DeleteSticker(w, r)`.

- [ ] **Step 1: Написать failing тест (permission denied)**

Создать `server/internal/delivery/http/handler/sticker_test.go` по образцу `user_test.go`. Заглушка usecase — не заглушка, т.к. используем реальный хендлер со мок-nucase. Определим `MockStickerUseCase`:

```go
package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
)

type MockStickerUseCase struct{ mock.Mock }

func (m *MockStickerUseCase) CreateSticker(serverID, userID uuid.UUID, name string, data []byte) (*domain.Sticker, error) {
	args := m.Called(serverID, userID, name, data)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Sticker), args.Error(1)
}
func (m *MockStickerUseCase) ListStickers(serverID, userID uuid.UUID) ([]*domain.Sticker, error) {
	args := m.Called(serverID, userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Sticker), args.Error(1)
}
func (m *MockStickerUseCase) DeleteSticker(serverID, stickerID, userID uuid.UUID) error {
	return m.Called(serverID, stickerID, userID).Error(0)
}
```

Тест: POST с запретом → 403 forbidden. Контекст с `user_id`:
```go
func setUserID(r *http.Request, uid uuid.UUID) *http.Request {
	ctx := context.WithValue(r.Context(), "user_id", uid)
	return r.WithContext(ctx)
}

func TestStickerHandler_Create_Denied(t *testing.T) {
	uc := &MockStickerUseCase{}
	uc.On("CreateSticker", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Return(nil, domain.ErrStickerForbidden)

	h := NewStickerHandler(uc, nil, nil)
	body := "--x\nContent-Disposition: form-data; name=\"name\"\n\nhello\n--x\nContent-Disposition: form-data; name=\"image\"; filename=\"s.png\"\nContent-Type: image/png\n\n\U0001F4A9\n--x--\n"
	req := httptest.NewRequest(http.MethodPost, "/api/v1/servers/{id}/stickers", strings.NewReader(body))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	req = setUserID(req, uuid.New())
	rec := httptest.NewRecorder()

	h.CreateSticker(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
}
```
Импорт `context`. (Границы multipart в реальном тесте генерируются через `multipart.NewWriter` — в шаге реализации используем корректную генерацию.)

- [ ] **Step 2: Запустить тест — fail**

Run: `cd server && go test ./internal/delivery/http/handler/ -run TestStickerHandler_Create_Denied`
Expected: FAIL — undefined: NewStickerHandler.

- [ ] **Step 3: Реализовать хендлер**

`server/internal/delivery/http/handler/sticker.go`:
```go
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

const (
	// maxStickerRequestBytes — лимит сырого multipart-тела запроса стикера.
	maxStickerRequestBytes = 3 << 20
	// maxStickerFileBytes — лимит содержимого файла стикера.
	maxStickerFileBytes = 2 << 20
)

type StickerHandler struct {
	stickerUseCase domain.StickerUseCase
	log            *slog.Logger
}

func NewStickerHandler(stickerUseCase domain.StickerUseCase, _ *ws.Hub, log *slog.Logger) *StickerHandler {
	return &StickerHandler{stickerUseCase: stickerUseCase, log: log}
}

// CreateSticker принимает multipart/form-data с полями "name" и "image" (PNG/JPEG, ≤2MB).
func (h *StickerHandler) CreateSticker(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxStickerRequestBytes)
	if err := r.ParseMultipartForm(maxStickerRequestBytes); err != nil {
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeStickerTooLarge, "sticker file is too large")
		return
	}
	defer r.MultipartForm.RemoveAll()

	name := r.FormValue("name")
	file, _, err := r.FormFile("image")
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerImageRequired, "sticker image is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxStickerFileBytes+1))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerReadFailed, "failed to read sticker file")
		return
	}
	if len(data) > maxStickerFileBytes {
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeStickerTooLarge, "sticker file is too large")
		return
	}

	sticker, err := h.stickerUseCase.CreateSticker(serverID, userID, name, data)
	if err != nil {
		h.writeStickerError(w, r, err)
		return
	}

	h.sendJSON(w, http.StatusCreated, sticker)
}

func (h *StickerHandler) ListStickers(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	stickers, err := h.stickerUseCase.ListStickers(serverID, userID)
	if err != nil {
		h.writeStickerError(w, r, err)
		return
	}
	if stickers == nil {
		stickers = []*domain.Sticker{}
	}
	h.sendJSON(w, http.StatusOK, stickers)
}

func (h *StickerHandler) DeleteSticker(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}
	stickerID, err := uuid.Parse(r.PathValue("sticker_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidStickerID, "invalid sticker id")
		return
	}

	if err := h.stickerUseCase.DeleteSticker(serverID, stickerID, userID); err != nil {
		h.writeStickerError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *StickerHandler) writeStickerError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrStickerForbidden), errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
	case errors.Is(err, domain.ErrStickerNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeStickerNotFound, "sticker not found")
	case errors.Is(err, domain.ErrStickerNameRequired):
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerNameRequired, "sticker name is required")
	case errors.Is(err, domain.ErrStickerNameTooLong):
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerNameTooLong, "sticker name is too long")
	case errors.Is(err, domain.ErrStickerImageRequired):
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerImageRequired, "sticker image is required")
	case errors.Is(err, domain.ErrUnsupportedAvatarFormat):
		h.sendError(w, http.StatusBadRequest, httperr.CodeUnsupportedImageType, "unsupported format: only PNG and JPEG are allowed")
	case errors.Is(err, domain.ErrInvalidAvatarImage):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidImage, "invalid image file")
	case errors.Is(err, domain.ErrInvalidAvatarDimensions):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidImageSize, "image dimensions are out of allowed range")
	default:
		h.log.Error("sticker request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}

func (h *StickerHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *StickerHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
```
**Примечание:** `NewStickerHandler` сигнатура `(uc domain.StickerUseCase, hub *ws.Hub, log *slog.Logger)`. Импорт `ws` добавлять не нужно, если параметр назван `_ *ws.Hub` — но тогда требуется импорт `ws`. Проще: убрать hub из хендлера вовсе (стикерные события не рассылаются через WS — изменения видны через refetch). Сигнатура `NewStickerHandler(stickerUseCase domain.StickerUseCase, log *slog.Logger)`. Обновить тест и main.go соответственно.

- [ ] **Step 4: Добавить err-codes в httperr**

В `server/internal/delivery/http/httperr/httperr.go` добавить коды (рядом с CodeAvatar*):
```go
	CodeStickerTooLarge       = "sticker_file_too_large"
	CodeStickerImageRequired  = "sticker_image_required"
	CodeStickerReadFailed     = "sticker_read_failed"
	CodeStickerNotFound       = "sticker_not_found"
	CodeStickerNameRequired   = "sticker_name_required"
	CodeStickerNameTooLong    = "sticker_name_too_long"
	CodeInvalidStickerID      = "invalid_sticker_id"
```

- [ ] **Step 5: Зарегистрировать хендлер и маршруты в main.go**

В `server/cmd/api/main.go`:
- после `roleRepo` добавить `stickerRepo := postgres.NewStickerRepository(db)` (рядом со строками репозиториев).
- после `messageUseCase` добавить `stickerUseCase := usecase.NewStickerUseCase(stickerRepo, serverRepo, permissionUseCase, storage)`.
- после `messageHandler` добавить `stickerHandler := handler.NewStickerHandler(stickerUseCase, log)`.
- в разделе маршрутов, рядом с Server routes:
```go
	// Sticker routes
	router.HandleFunc("POST /api/v1/servers/{id}/stickers", authMid.RequireAuth(stickerHandler.CreateSticker))
	router.HandleFunc("GET /api/v1/servers/{id}/stickers", authMid.RequireAuth(stickerHandler.ListStickers))
	router.HandleFunc("DELETE /api/v1/servers/{id}/stickers/{sticker_id}", authMid.RequireAuth(stickerHandler.DeleteSticker))
```

- [ ] **Step 6: Прогнать сборку и тесты**

Run: `cd server && go build ./... && go test ./internal/delivery/http/handler/`
Expected: сборка ок, тесты pass.

- [ ] **Step 7: Commit**

```bash
git add server/internal/delivery/http/handler/sticker.go server/internal/delivery/http/handler/sticker_test.go server/cmd/api/main.go server/internal/delivery/http/httperr/httperr.go
git commit -m "feat: add sticker HTTP handlers and routes"
```

---

### Task 7: Стикер-сообщение в usecase и handler сообщений

**Files:**
- Modify: `server/internal/domain/usecase.go:60-67` (сигнатура `CreateMessage`)
- Modify: `server/internal/usecase/message.go:82-106` (логика стикера)
- Modify: `server/internal/delivery/http/handler/message.go:33-72` (CreateMessageRequest + валидация)

**Interfaces:**
- Consumes: `domain.StickerRepository` (Task 2) и `domain.Sticker` — для валидации принадлежности сервера, `domain.Message.StickerID`.
- Produces: обновлённая `MessageUseCase.CreateMessage(channelID, userID uuid.UUID, content string, stickerID *uuid.UUID) (*Message, error)`.

- [ ] **Step 1: Обновить интерфейс `MessageUseCase`**

`server/internal/domain/usecase.go` — заменить `CreateMessage`:
```go
	CreateMessage(channelID, userID uuid.UUID, content string, stickerID *uuid.UUID) (*Message, error)
```
Также `domain.Message.StickerID` уже есть (Task 3). `Message.Content` остаётся `string`; для стикер-сообщения он заполняется пустой строкой.

- [ ] **Step 2: Обновить usecase `CreateMessage`**

`server/internal/usecase/message.go:82-106` заменить на:
```go
func (uc *messageUseCase) CreateMessage(channelID, userID uuid.UUID, content string, stickerID *uuid.UUID) (*domain.Message, error) {
	ch, err := uc.requirePermission(channelID, userID, domain.PermSendMessages)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	msg := &domain.Message{
		ID:        uuid.New(),
		ChannelID: channelID,
		UserID:    userID,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if stickerID == nil {
		if content == "" {
			return nil, domain.ErrMessageEmpty
		}
		if err := uc.validateMentions(ch.ServerID, userID, content); err != nil {
			return nil, err
		}
		msg.Content = content
	} else {
		// Сообщение-стикер: текста нет, но Content — непустая строка в смысле
		// NULL; кладём пустую строку (колонка content NOT NULL).
		msg.Content = ""

		// Стикер обязан существовать и принадлежать серверу канала.
		sticker, err := uc.stickerRepo.GetByID(*stickerID)
		if err != nil {
			return nil, err
		}
		if sticker.ServerID != ch.ServerID {
			return nil, domain.ErrStickerNotFound
		}
		msg.StickerID = stickerID
		msg.Sticker = sticker
	}

	if err := uc.messageRepo.Create(msg); err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	return msg, nil
}
```
`domain.ErrMessageEmpty` — новая sentinel-ошибка (пустое сообщение):
```go
	// ErrMessageEmpty — сообщение пустое.
	ErrMessageEmpty = errors.New("message content is empty")
```
В `errors.go`. Также `messageUseCase` структура должна получить поле `stickerRepo domain.StickerRepository` и конструироваться с ним — обновить `NewMessageUseCase` (Step 3).

- [ ] **Step 3: Прокинуть stickerRepo в messageUseCase**

`server/internal/usecase/message.go` — структура и конструктор:
```go
type messageUseCase struct {
	messageRepo domain.MessageRepository
	channelRepo domain.ChannelRepository
	serverRepo  domain.ServerRepository
	stickerRepo domain.StickerRepository
	perms       domain.PermissionUseCase
}

func NewMessageUseCase(
	messageRepo domain.MessageRepository,
	channelRepo domain.ChannelRepository,
	serverRepo domain.ServerRepository,
	stickerRepo domain.StickerRepository,
	perms domain.PermissionUseCase,
) domain.MessageUseCase {
	return &messageUseCase{
		messageRepo: messageRepo,
		channelRepo: channelRepo,
		serverRepo:  serverRepo,
		stickerRepo: stickerRepo,
		perms:       perms,
	}
}
```
Обновить вызов в `main.go:95`:
```go
	messageUseCase := usecase.NewMessageUseCase(messageRepo, channelRepo, serverRepo, stickerRepo, permissionUseCase)
```
(stickerRepo создаётся в Task 6 до messageUseCase — перенести объявление `stickerRepo := postgres.NewStickerRepository(db)` выше строки messageUseCase.)

- [ ] **Step 4: Обновить handler CreateMessage**

`server/internal/delivery/http/handler/message.go` — `CreateMessageRequest` и логика:
```go
type CreateMessageRequest struct {
	Content   string     `json:"content"`
	StickerID *uuid.UUID `json:"sticker_id"`
}
```
В `CreateMessage` заменить блок валидации `if req.Content == ""` на:
```go
	if req.Content == "" && req.StickerID == nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeMessageEmpty, "message content is required")
		return
	}
	if req.StickerID != nil && req.Content != "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerWithText, "sticker messages cannot contain text")
		return
	}

	msg, err := h.messageUseCase.CreateMessage(channelID, userID, req.Content, req.StickerID)
```
Добавить `httperr.CodeStickerWithText = "sticker_with_text"` в `httperr.go`.

- [ ] **Step 5: Написать тесты usecase на стикер-сообщение**

В `server/internal/usecase/message_test.go` добавить тест:
```go
func TestMessageUseCase_CreateStickerMessage_InvalidServer(t *testing.T) {
	// Стикер принадлежит другому серверу → ErrStickerNotFound.
	// Setup: channel в serverA, sticker в serverB.
}
func TestMessageUseCase_CreateStickerMessage_EmptyIsAllowed(t *testing.T) {
	// stickerID задан, content пустой → успех, msg.Content == "", StickerID == stickerID.
}
```
Использовать существующие моки `MockMessageRepository`, `MockChannelRepository`, `MockPermissionUseCase`, `MockServerRepository` пакета. Добавить `MockStickerRepository` (из Task 5 sticker_test.go — он в том же пакете `usecase_test`). Полный код тестов:
```go
func TestMessageUseCase_CreateStickerMessage_EmptyIsAllowed(t *testing.T) {
	msgRepo := &MockMessageRepository{}
	msgRepo.On("Create", mock.MatchedBy(func(m *domain.Message) bool { return m.StickerID != nil })).Return(nil)

	ch := &domain.Channel{ID: uuid.New(), ServerID: uuid.New()}
	chRepo := &MockChannelRepository{}
	chRepo.On("GetByID", ch.ID).Return(ch, nil)

	perms := &MockPermissionUseCase{}
	perms.On("Resolve", ch.ServerID, mock.Anything).Return(domain.PermissionSet{}, nil)

	sticker := &domain.Sticker{ID: uuid.New(), ServerID: ch.ServerID}
	stickerRepo := &MockStickerRepository{}
	stickerRepo.On("GetByID", sticker.ID).Return(sticker, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, &MockServerRepository{}, stickerRepo, perms)
	msg, err := uc.CreateMessage(ch.ID, uuid.New(), "", &sticker.ID)
	require.NoError(t, err)
	assert.Equal(t, "", *msg.Content)
	assert.Equal(t, sticker.ID, *msg.StickerID)
	assert.Equal(t, sticker, msg.Sticker)
}
```
(Использовать сигнатуру `NewMessageUseCase` с 5 аргументами из Step 3.)

- [ ] **Step 6: Запустить тесты**

Run: `cd server && go test ./internal/usecase/ ./internal/delivery/http/handler/`
Expected: PASS. Исправить все места вызова `NewMessageUseCase` в тестах, чтобы передавать 5 аргументов (MockStickerRepository).

- [ ] **Step 7: Сборка и тесты**

Run: `cd server && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/internal/domain/usecase.go server/internal/usecase/message.go server/internal/usecase/message_test.go server/internal/delivery/http/handler/message.go server/internal/delivery/http/httperr/httperr.go server/cmd/api/main.go server/internal/domain/errors.go
git commit -m "feat: support sticker_id in message creation"
```

---

### Task 8: Клиентские типы

**Files:**
- Modify: `client/src/types/index.ts:52-60`

**Interfaces:**
- Consumes: существующая `Sticker` структура (по образцу серверной).
- Produces:
  - `export interface Sticker { id: string; server_id: string; name: string; image_url: string; created_by: string; created_at: string }`
  - `Message` получает `sticker_id?: string`, `sticker?: Sticker`. `content` остаётся `string` (НЕ nullable).

- [ ] **Step 1: Добавить тип `Sticker` и обновить `Message`**

В `client/src/types/index.ts`, заменить блок `Message`:
```ts
export interface Sticker {
  id: string;
  server_id: string;
  name: string;
  image_url: string;
  created_by: string;
  created_at: string;
}

export interface Message {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  attachments?: string[];
  sticker_id?: string;
  sticker?: Sticker;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Сборка клиента**

Run: `cd client && npx tsc --noEmit`
Expected: PASS — `content` остался строкой, существующие использования не ломаются.

- [ ] **Step 3: Commit**

```bash
git add client/src/types/index.ts
git commit -m "feat: add Sticker type and extend Message client type"
```

---

### Task 9: Клиентские методы api для стикеров

**Files:**
- Modify: `client/src/services/api.ts:329-334` (createMessage сигнатура) и добавление методов стикеров.

**Interfaces:**
- Consumes: `Sticker` тип (Task 8).
- Produces:
  - `createMessage(channelId: string, content: string, stickerId?: string)`
  - `listStickers(serverId: string): Promise<Sticker[]>`
  - `uploadSticker(serverId: string, name: string, blob: Blob): Promise<Sticker>`
  - `deleteSticker(serverId: string, stickerId: string): Promise<void>`

- [ ] **Step 1: Обновить `createMessage`**

`client/src/services/api.ts:329-334`:
```ts
  async createMessage(channelId: string, content: string, stickerId?: string) {
    return this.request(`/api/v1/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, sticker_id: stickerId }),
    });
  }
```
JSON.stringify корректно опускает `sticker_id` при undefined.

- [ ] **Step 2: Добавить методы стикеров** (в конце класса в секции Messages, после deleteMessage):

```ts
  // Stickers
  async listStickers(serverId: string) {
    return this.request<Sticker[]>(`/api/v1/servers/${serverId}/stickers`);
  }

  async uploadSticker(serverId: string, name: string, blob: Blob) {
    const formData = new FormData();
    formData.append('image', blob, `sticker-${Date.now()}.png`);
    formData.append('name', name);
    return this.requestForm<Sticker>(`/api/v1/servers/${serverId}/stickers`, {
      method: 'POST',
      body: formData,
    });
  }

  async deleteSticker(serverId: string, stickerId: string) {
    return this.requestForm<void>(`/api/v1/servers/${serverId}/stickers/${stickerId}`, {
      method: 'DELETE',
    });
  }
```
Импорт `Sticker` из `@/types` — проверить, что он есть (или добавить).

- [ ] **Step 3: Сборка**

Run: `cd client && npx tsc --noEmit`
Expected: возможные ошибки `content`-строки вне задач — фиксируем в Task 10.

- [ ] **Step 4: Commit**

```bash
git add client/src/services/api.ts
git commit -m "feat: add sticker api methods and sticker_id to createMessage"
```

---

### Task 10: Набор эмодзи и рендер стикер-сообщений

**Files:**
- Create: `client/src/utils/emojis.ts`
- Modify: `client/src/utils/markdown.ts` (если `content` передаётся как `string` везде — проверить)
- Modify: `client/src/components/ChatArea.tsx` (рендер стикер-сообщений и `startEdit`)

**Interfaces:**
- Consumes: `Message` (Task 8) — `content: string`, `sticker_id?`, `sticker?`.
- Produces:
  - `export const EMOJI_CATEGORIES: { id: string; label: string; emojis: string[] }[]`
  - рендер: если `msg.sticker_id` — `<img class="message-sticker">`; иначе `renderMessageBody(msg.content, ...)`.

- [ ] **Step 1: Создать набор эмодзи**

`client/src/utils/emojis.ts`:
```ts
export interface EmojiCategory {
  id: string;
  label: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: 'smileys', label: '😀 Smileys', emojis: ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜', '🤪', '🤔', '😎', '🤩', '🥳', '😭', '😡', '😱', '🥺', '😴', '🤯', '🥱'] },
  { id: 'gestures', label: '👋 Gestures', emojis: ['👋', '🤚', '🖐️', '✋', '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '🙏', '🤝', '💪', '👈', '👉', '☝️', '👇'] },
  { id: 'animals', label: '🐶 Animals', emojis: ['🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦄', '🐝', '🐢', '🐙', '🦋'] },
  { id: 'food', label: '🍕 Food', emojis: ['🍎', '🍌', '🍓', '🍉', '🍇', '🍕', '🍔', '🍟', '🌭', '🍿', '🍩', '🍪', '🎂', '🍰', '🍫', '☕', '🍺', '🥤', '🍦', '🥟'] },
  { id: 'activities', label: '⚽ Activities', emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🎳', '🏆', '🥇', '🎮', '🎲', '🎯', '🎸', '🎹', '🎤', '🎧', '🎬', '✈️', '🚗', '🚀', '🏠'] },
  { id: 'objects', label: '💡 Objects', emojis: ['💡', '🔑', '📱', '💻', '🖥️', '⌚', '📷', '🎥', '📝', '📚', '✏️', '🖊️', '📌', '📎', '🔒', '🔨', '🎁', '💊', '🧲', '🛒'] },
  { id: 'symbols', label: '❤️ Symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '💯', '❗', '❓', '❗', '⭐', '✨', '🔥', '💤', '💢', '💥', '✅', '❌'] },
];
```
(Маркер категорий прост и достаточен; точный набор не критичен. Важно: `label` — только для тестов/доступности, в UI используем id.)

- [ ] **Step 2: Написать тест на корректность набора**

Создать `client/src/utils/__tests__/emojis.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EMOJI_CATEGORIES } from '@/utils/emojis';

describe('EMOJI_CATEGORIES', () => {
  it('has unique category ids', () => {
    const ids = EMOJI_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every category has non-empty emojis list', () => {
    for (const c of EMOJI_CATEGORIES) {
      expect(c.emojis.length).toBeGreaterThan(0);
    }
  });

  it('every emoji is a non-empty string', () => {
    for (const c of EMOJI_CATEGORIES) {
      for (const e of c.emojis) {
        expect(e.length).toBeGreaterThan(0);
      }
    }
  });
});
```
Путь алиаса `@/*` → `src/*` (проверить в vite/tsconfig). Если алиас не настроен в vitest, использовать относительный `../emojis`.

- [ ] **Step 3: Запустить тест**

Run: `cd client && npx vitest run src/utils/__tests__/emojis.test.ts`
Expected: PASS.

- [ ] **Step 4: Правка рендера стикер-сообщений в ChatArea**

В `ChatArea.tsx:769`, блок рендера: если `msg.sticker_id` — рисовать стикер-картинку, иначе текст. Заменить текущий тернарник на:

Рендер (заменить блок `: (<div className="message-text">{renderMessageBody(msg.content, ...)}</div>)`):
```tsx
) : msg.sticker_id && msg.sticker ? (
  <div className="message-sticker-wrap">
    <img className="message-sticker" src={msg.sticker.image_url} alt={msg.sticker.name} />
  </div>
) : msg.sticker_id ? (
  <div className="message-text">{t('chat.stickerRemoved')}</div>
) : (
  <div className="message-text">{renderMessageBody(msg.content, members, t, user?.id)}</div>
```
Точно: сейчас это `) : ( <div className="message-text">...` — заменить.

Правка `startEdit` и кнопки Edit: для стикер-сообщений скрыть кнопку редактирования. В условии показа кнопки (`isFromMe && !isEditing`) — кнопку Edit рендерить только если `!msg.sticker_id`:
```tsx
{isFromMe && !isEditing && !msg.sticker_id && (
  <button ... onClick={() => startEdit(msg)}><svg/></button>
)}
{isFromMe && !isEditing && (
  <button ... delete .../>
)}
```

В `startEdit` — защита: `if (msg.sticker_id) return;`

- [ ] **Step 5: Сборка клиента**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (`content` остаётся строкой).

- [ ] **Step 6: Commit**

```bash
git add client/src/utils/emojis.ts client/src/utils/__tests__/emojis.test.ts client/src/components/ChatArea.tsx
git commit -m "feat: add emoji dataset and render sticker messages"
```

---

### Task 11: EmojiPicker компонент

**Files:**
- Create: `client/src/components/EmojiPicker.tsx`
- Modify: `client/src/components/ChatArea.tsx` (иконки + интеграция)
- Modify: `client/src/components/ChatArea.css`

**Interfaces:**
- Consumes: `EMOJI_CATEGORIES` (Task 10), `useT`.
- Produces:
  - `function EmojiPicker({ categories, onSelect, onClose }: { categories: EmojiCategory[]; onSelect: (emoji: string) => void; onClose: () => void })`
  - вставка эмодзи на позицию каретки: `insertEmojiAtCaret(textarea, emoji)`.

- [ ] **Step 1: Создать EmojiPicker**

`client/src/components/EmojiPicker.tsx`:
```tsx
import { useState } from 'react';
import { EMOJI_CATEGORIES, type EmojiCategory } from '@/utils/emojis';
import { useT } from '@/i18n';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const t = useT();
  const [active, setActive] = useState(EMOJI_CATEGORIES[0].id);

  return (
    <div className="emoji-picker" role="dialog">
      <div className="emoji-picker-grid">
        {EMOJI_CATEGORIES.find((c) => c.id === active)?.emojis.map((e, i) => (
          <button
            key={`${active}-${i}`}
            type="button"
            className="emoji-cell"
            onClick={() => onSelect(e)}
            aria-label={t('chat.insertEmoji')}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="emoji-picker-tabs">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`emoji-tab${c.id === active ? ' active' : ''}`}
            onClick={() => setActive(c.id)}
            title={c.label}
          >
            {c.emojis[0]}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Создать утилиту вставки эмодзи по каретке**

В `ChatArea.tsx` (или отдельный `utils/`) — функция:
```ts
function insertEmojiAtCaret(el: HTMLTextAreaElement, setValue: (v: string) => void, emoji: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + emoji + el.value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start + emoji.length, start + emoji.length);
  });
}
```
Если выносится в `utils`, добавить тест. Для простоты — приватная функция внутри `ChatArea`.

- [ ] **Step 3: Добавить иконку эмодзи в тулбар**

В `ChatArea.tsx`, в тулбар составления (после кнопки «Маркированный список», ~стр. 837-839) добавить кнопку:
```tsx
<button type="button" className="toolbar-btn" aria-label={t('chat.emoji')} title={t('chat.emoji')} onClick={() => setEmojiPickerOpen((open) => !open)}>
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
</button>
```
В режиме редактирования (около стр. 747-749) — аналогично с `setEditEmojiPickerOpen`.
Добавить состояние: `const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);` и `const [editEmojiPickerOpen, setEditEmojiPickerOpen] = useState(false);`. `onSelect` вызывает `insertEmojiAtCaret(inputRef.current, setInput, e)` и закрывает пикер.

- [ ] **Step 4: Рендер пикера** (возле `LinkDialog`, ~стр. 908-912):
```tsx
{emojiPickerOpen && (
  <EmojiPicker
    onSelect={(e) => { insertEmojiAtCaret(inputRef.current!, setInput, e); setEmojiPickerOpen(false); }}
    onClose={() => setEmojiPickerOpen(false)}
  />
)}
```
(аналог для edit-режима с setEditValue/editInputRef).

- [ ] **Step 5: CSS**

В `ChatArea.css` добавить стили `.emoji-picker`, `.emoji-picker-grid`, `.emoji-cell`, `.emoji-picker-tabs`, `.emoji-tab` (минимальные: абсолютное позиционирование поверх ввода, тёмная тема). Также `.message-sticker`, `.message-sticker-wrap`, `.toolbar-btn.active`.

- [ ] **Step 6: Сборка и тесты**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/EmojiPicker.tsx client/src/components/ChatArea.tsx client/src/components/ChatArea.css
git commit -m "feat: add emoji picker with category tabs"
```

---

### Task 12: StickerPicker и StickerManager

**Files:**
- Create: `client/src/components/StickerPicker.tsx`
- Create: `client/src/components/StickerManager.tsx`
- Modify: `client/src/components/ChatArea.tsx` (иконка стикеров + интеграция + sendSticker)
- Modify: `client/src/components/ChatArea.css`
- Modify: `client/src/utils/permissions.ts` — не требует изменений (MANAGE_SERVER уже есть).

**Interfaces:**
- Consumes: `apiService`, `Sticker` тип (Task 8), `can`/`PERMISSIONS` (`permissions.ts`), `useServerStore`.
- Produces:
  - `function StickerPicker({ stickers, onSelect, onClose, onManage }: ...)`
  - `function StickerManager({ serverId, onClose }: ...)`
  - `sendSticker(sticker: Sticker)` в ChatArea.

- [ ] **Step 1: Создать StickerPicker**

`client/src/components/StickerPicker.tsx`:
```tsx
import { useT } from '@/i18n';
import type { Sticker } from '@/types';

interface StickerPickerProps {
  stickers: Sticker[];
  onSelect: (s: Sticker) => void;
  onClose: () => void;
  onManage?: () => void;
}

export function StickerPicker({ stickers, onSelect, onClose, onManage }: StickerPickerProps) {
  const t = useT();
  return (
    <div className="sticker-picker" role="dialog">
      <div className="sticker-picker-grid">
        {stickers.length === 0 ? (
          <div className="sticker-empty">{t('chat.noStickers')}</div>
        ) : (
          stickers.map((s) => (
            <button key={s.id} type="button" className="sticker-cell" onClick={() => onSelect(s)}>
              <img src={s.image_url} alt={s.name} />
            </button>
          ))
        )}
      </div>
      {onManage && (
        <button type="button" className="sticker-manage-btn" onClick={onManage}>
          {t('chat.manageStickers')}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Создать StickerManager**

`client/src/components/StickerManager.tsx`:
```tsx
import { useEffect, useState, type ChangeEvent } from 'react';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import type { Sticker } from '@/types';

interface StickerManagerProps {
  serverId: string;
  onClose: () => void;
}

export function StickerManager({ serverId, onClose }: StickerManagerProps) {
  const t = useT();
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiService.listStickers(serverId).then(setStickers).catch((e) => setError(apiErrorText(e, t)));
  }, [serverId]);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      const created = await apiService.uploadSticker(serverId, name.trim(), file);
      setStickers((prev) => [...prev, created]);
      setName('');
      setError(null);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('chat.deleteStickerConfirm'))) return;
    try {
      await apiService.deleteSticker(serverId, id);
      setStickers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(apiErrorText(err, t));
    }
  };

  return (
    <div className="sticker-manager-overlay" onClick={onClose}>
      <div className="sticker-manager" onClick={(e) => e.stopPropagation()}>
        <h3>{t('chat.manageStickersTitle')}</h3>
        <div className="sticker-manager-upload">
          <input type="text" placeholder={t('chat.stickerNamePlaceholder')} value={name}
            onChange={(e) => setName(e.target.value)} />
          <input type="file" accept="image/png,image/jpeg" onChange={handleFile} disabled={busy} />
        </div>
        {error && <div className="error-toast">{error}</div>}
        <div className="sticker-manager-list">
          {stickers.map((s) => (
            <div key={s.id} className="sticker-manager-item">
              <img src={s.image_url} alt={s.name} width={48} height={48} />
              <span>{s.name}</span>
              <button type="button" onClick={() => handleDelete(s.id)}>{t('common.delete')}</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={onClose}>{t('common.close')}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Интегрировать в ChatArea**

Добавить состояния в `ChatArea`: `const [stickerPickerOpen, setStickerPickerOpen] = useState(false);` `const [stickerManagerOpen, setStickerManagerOpen] = useState(false);` `const [serverStickers, setServerStickers] = useState<Sticker[]>([]);`. Загрузка стикеров сервера при смене канала (в effect после `channel?.id`):
```ts
if (channel?.id) {
  const sid = currentServer?.id;
  if (sid) {
    apiService.listStickers(sid).then((s) => {
      if (sid === currentServer?.id) setServerStickers(s);
    }).catch(() => {});
  }
}
```
`canManageStickers = can(permissions, PERMISSIONS.MANAGE_SERVER)` (permissions уже из store).

`sendSticker`:
```ts
const sendSticker = async (sticker: Sticker) => {
  if (!channel || !user) return;
  try {
    const msg = await apiService.createMessage(channel.id, '', sticker.id) as Message;
    addMessage(msg);
    setStickerPickerOpen(false);
  } catch (err) {
    setSendError(apiErrorText(err, t));
    setTimeout(() => setSendError(null), 5000);
  }
};
```

Иконка стикеров в тулбар (после кнопки «Маркированный список» и перед/после эмодзи):
```tsx
<button type="button" className="toolbar-btn" aria-label={t('chat.stickers')} title={t('chat.stickers')} onClick={() => setStickerPickerOpen((open) => !open)}>
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M12 3a9 9 0 0 1 9 9"/><path d="M21 12h-4l-2 2-2-2"/></svg>
</button>
```
(иконка носовая, но допустима; валидный SVG из существующих).

Рендер пикера вниз (возле LinkDialog):
```tsx
{stickerPickerOpen && (
  <StickerPicker
    stickers={serverStickers}
    onSelect={sendSticker}
    onClose={() => setStickerPickerOpen(false)}
    onManage={canManageStickers ? () => setStickerManagerOpen(true) : undefined}
  />
)}
{stickerManagerOpen && channel && (
  <StickerManager
    serverId={channel.server_id}
    onClose={() => { setStickerManagerOpen(false); setStickerPickerOpen(false); }}
  />
)}
```
Проверить: `Channel` тип имеет `server_id` (проверить в `types/index.ts`; если нет — использовать `currentServer.id`).

- [ ] **Step 4: CSS**

В `ChatArea.css`: `.sticker-picker`, `.sticker-picker-grid`, `.sticker-cell`, `.sticker-manage-btn`, `.sticker-empty`, `.sticker-manager-overlay`, `.sticker-manager`, `.sticker-manager-upload`, `.sticker-manager-list`, `.sticker-manager-item`.

- [ ] **Step 5: Сборка и тесты**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/StickerPicker.tsx client/src/components/StickerManager.tsx client/src/components/ChatArea.tsx client/src/components/ChatArea.css
git commit -m "feat: add sticker picker and manager"
```

---

### Task 13: i18n ключи (ru + en)

**Files:**
- Modify: `client/src/i18n/locales/ru.ts` (chat секция + errors)
- Modify: `client/src/i18n/locales/en.ts` (зеркально)

**Interfaces:**
- Consumes: ключи из Tasks 11-12.
- Produces: ключи `chat.emoji`, `chat.insertEmoji`, `chat.stickers`, `chat.noStickers`, `chat.manageStickers`, `chat.manageStickersTitle`, `chat.stickerNamePlaceholder`, `chat.deleteStickerConfirm`, `chat.stickerRemoved`, и `errors.*` для стикерных кодов.

- [ ] **Step 1: Добавить chat-ключи в ru.ts**

В `ru.ts` секцию `chat:` добавить:
```ts
    emoji: 'Эмодзи',
    insertEmoji: 'Вставить эмодзи',
    stickers: 'Стикеры',
    noStickers: 'В этом сервере пока нет стикеров',
    manageStickers: 'Управлять стикерами',
    manageStickersTitle: 'Стикеры сервера',
    stickerNamePlaceholder: 'Имя стикера',
    deleteStickerConfirm: 'Удалить этот стикер?',
    stickerRemoved: 'Стикер удалён',
```

- [ ] **Step 2: Добавить errors-ключи в ru.ts**

В `errors:` секцию:
```ts
    sticker_file_too_large: 'Файл стикера слишком большой',
    sticker_image_required: 'Прикрепите изображение стикера',
    sticker_read_failed: 'Не удалось прочитать файл стикера',
    sticker_not_found: 'Стикер не найден',
    sticker_name_required: 'Введите имя стикера',
    sticker_name_too_long: 'Имя стикера не длиннее 100 символов',
    sticker_with_text: 'Сообщение-стикер не может содержать текст',
```

- [ ] **Step 3: Продублировать ключи в en.ts**

Добавить те же ключи в `en.ts` в те же секции (`chat:` и `errors:`), с английскими текстами:
```ts
    emoji: 'Emoji',
    insertEmoji: 'Insert emoji',
    stickers: 'Stickers',
    noStickers: 'No stickers in this server yet',
    manageStickers: 'Manage stickers',
    manageStickersTitle: 'Server stickers',
    stickerNamePlaceholder: 'Sticker name',
    deleteStickerConfirm: 'Delete this sticker?',
    stickerRemoved: 'Sticker removed',
```
errors:
```ts
    sticker_file_too_large: 'Sticker file is too large',
    sticker_image_required: 'Attach a sticker image',
    sticker_read_failed: 'Failed to read sticker file',
    sticker_not_found: 'Sticker not found',
    sticker_name_required: 'Enter a sticker name',
    sticker_name_too_long: 'Sticker name must be 100 characters or fewer',
    sticker_with_text: 'A sticker message cannot contain text',
```

- [ ] **Step 4: Проверить i18n-консистентность**

Run: `cd client && npm run check:i18n`
Expected: PASS (нет расхождений ключей ru/en).

- [ ] **Step 5: Commit**

```bash
git add client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "feat: add i18n keys for emoji and stickers"
```

---

### Task 14: Итоговая проверка и E2E smoke

**Files:**
- Modify: (по необходимости) `server/tests/` E2E, если есть message-тесты.
- Проверка: сборка сервера, тесты сервера, сборка и тесты клиента, миграция.

**Interfaces:** финальная проверка целостности (не производит новых типов).

- [ ] **Step 1: Сборка и тесты сервера**

Run: `cd server && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 2: Сборка и тесты клиента**

Run: `cd client && npm run build && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Проверка миграции вверх/вниз**

Run: `cd server && make migrate-down && make migrate-up`
Expected: обе успешны (обратимость 015).

- [ ] **Step 4: Ручной smoke (диаграмма)**

Опционально: запустить `make docker-up`, `make run`, `npm run dev`, создать сервер → «Управлять стикерами» → загрузить PNG → открыть пикер стикеров → отправить стикер → проверить, что в ленте отображается картинка и `content: null`. Также вставить эмодзи в поле и отправить текст с эмодзи.

- [ ] **Step 5: Итоговый статус**

Убедиться, что все задачи 1–13 завершены и закоммичены. Обновить CHANGELOG.md записью о новой функции (кратко).
```bash
git add CHANGELOG.md
git commit -m "docs: changelog for emoji and sticker sending"
```

---

## Self-Review

**Spec coverage:**
- Таблица stickers + миграция → Task 1 ✓
- Домен, репозиторий, usecase, handler стикеров → Tasks 2, 4, 5, 6 ✓
- Обновление доставки сообщений (sticker_id) → Tasks 3, 7 ✓
- Клиентские типы и api → Tasks 8, 9 ✓
- Набор эмодзи + рендер → Tasks 10, 11 ✓
- StickerPicker/StickerManager → Task 12 ✓
- i18n → Task 13 ✓
- Тесты/граничные случаи → встроены в задачи + Task 14 ✓

**Notes:**
- `ErrStickerImageRequired` и `ErrMessageEmpty` и `CodeStickerWithText` должны быть добавлены в соответствующих местах (Task 5 Step 3, Task 7 Step 2, Task 7 Step 4).
- Проверка `Channel.server_id` на клиенте обязательна перед использованием в Task 12 (иначе использовать `currentServer.id`).
- В `Task 6 Note` — сигнатура `NewStickerHandler` упрощена без hub; убедиться в согласованном использовании в тесте и main.go.