# Редактирование и удаление сервера/каналов — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать владельцу сервера редактировать (название, иконка) и удалять сервер и его каналы, с REST API + WS-синхронизацией между всеми подключёнными клиентами, согласно спеке `docs/superpowers/specs/2026-07-28-server-channel-edit-delete-design.md`.

**Architecture:** Clean architecture слой за слоем: repository (`Update`/`Delete` уже готовы) → usecase (`serverUseCase` — новые методы с проверкой владельца через `requireOwner`) → HTTP handler (`PATCH`/`DELETE` на `ServerHandler`) → WS broadcast (`server_update`/`server_delete`/`channel_update`/`channel_delete` через `hub.BroadcastMessage`, глобально) → клиент (`api.ts` → `serverStore` → контекстное меню + модалки в `ServerList`/`ChannelSidebar` → WS-подписки в `AppPage`).

**Tech Stack:** Go 1.x (net/http, pgx/v5, testify/mock), React + TypeScript + zustand, нативный WebSocket-клиент.

## Global Constraints

- Только владелец сервера (`server.OwnerID == userID`) может редактировать/удалять сервер и его каналы — без исключений для admin/роли не проверяются.
- `user_id` для авторизации всегда берётся из JWT-контекста (`r.Context().Value("user_id")`), никогда из тела запроса/URL.
- Удаление — hard delete, каскад через существующие FK (`ON DELETE CASCADE` в миграциях 002-005) — новых миграций не требуется.
- Нельзя удалить последний канал сервера — проверка на usecase-уровне (источник истины, HTTP 400 `ErrLastChannel`), продублирована на клиенте только для UX (задизейбленный пункт меню).
- Имена WS-событий строго: `server_update`, `server_delete`, `channel_update`, `channel_delete` (глобальный broadcast через `hub.BroadcastMessage`, как у `user_updated`).
- Иконка сервера: PNG/JPEG, ≤2MB, размеры 32-4096px — те же ограничения, что у аватара пользователя; валидация переиспользуется через общий хелпер `validateImage`.
- Нет unit-test инфраструктуры на клиенте (React/zustand) — фронтенд-задачи проверяются через `npx tsc --noEmit` + вручную через dev-сервер, не автотестами (тот же прецедент, что в `docs/superpowers/plans/2026-07-15-message-edit-delete.md`).
- HTTP handler'ы в этом проекте не покрываются unit-тестами напрямую (только usecase-слой) — handler-таски проверяются через `go build`/`go vet`, сквозная проверка — в финальном таске.

---

### Task 1: Backend — вынести общую валидацию изображений в `usecase.validateImage`

**Проблема:** Проверка формата/размеров изображения сейчас дублируется только в `userUseCase.UpdateAvatar` (`server/internal/usecase/user.go:86-105`). Иконка сервера (Task 5) будет проверяться теми же правилами — выносим общий хелпер, чтобы не копипастить логику.

**Files:**
- Create: `server/internal/usecase/image.go`
- Modify: `server/internal/usecase/user.go`

**Interfaces:**
- Produces: `validateImage(data []byte) (ext, contentType string, err error)` — пакетный (не экспортируемый наружу `usecase`) хелпер, используется в Task 5 (`serverUseCase.UpdateServerIcon`).

- [ ] **Step 1: Создать `server/internal/usecase/image.go`**

```go
package usecase

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"

	"github.com/vycord/server/internal/domain"
)

const (
	minImageDimension = 32
	maxImageDimension = 4096
)

// validateImage проверяет, что data — валидный PNG или JPEG разумного
// разрешения, и возвращает расширение файла и определённый content-type
// для сохранения в файловое хранилище. Используется и для аватара
// пользователя (UpdateAvatar), и для иконки сервера (UpdateServerIcon).
func validateImage(data []byte) (ext, contentType string, err error) {
	contentType = http.DetectContentType(data)
	switch contentType {
	case "image/png":
		ext = "png"
	case "image/jpeg":
		ext = "jpg"
	default:
		return "", "", domain.ErrUnsupportedAvatarFormat
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", "", fmt.Errorf("%w: %v", domain.ErrInvalidAvatarImage, err)
	}
	if cfg.Width < minImageDimension || cfg.Height < minImageDimension ||
		cfg.Width > maxImageDimension || cfg.Height > maxImageDimension {
		return "", "", domain.ErrInvalidAvatarDimensions
	}

	return ext, contentType, nil
}
```

- [ ] **Step 2: Упростить `server/internal/usecase/user.go`, убрав дублирующую логику**

Заменить блок импортов (было `bytes`, `context`, `crypto/rand`, `encoding/hex`, `fmt`, `image`, `_ "image/jpeg"`, `_ "image/png"`, `net/http`, `uuid`, `domain`, `filestorage`) на:

```go
import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)
```

Убрать константы `minAvatarDimension`/`maxAvatarDimension` (строки 19-22 — заменены на `minImageDimension`/`maxImageDimension` в `image.go`).

Заменить начало `UpdateAvatar` (было — детект content-type + `image.DecodeConfig` + проверка размеров, строки 86-105) на:

```go
func (uc *userUseCase) UpdateAvatar(id uuid.UUID, data []byte) (*domain.User, error) {
	ext, contentType, err := validateImage(data)
	if err != nil {
		return nil, err
	}

	user, err := uc.userRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	oldAvatarURL := user.AvatarURL

	key := fmt.Sprintf("avatars/%s/%s.%s", id, randomHex(8), ext)
	url, err := uc.storage.Save(context.Background(), key, bytes.NewReader(data), contentType)
	if err != nil {
		return nil, fmt.Errorf("save avatar: %w", err)
	}

	if err := uc.userRepo.Update(id, map[string]interface{}{"avatar_url": url}); err != nil {
		return nil, fmt.Errorf("update avatar url: %w", err)
	}

	if oldAvatarURL != nil {
		_ = uc.storage.Delete(context.Background(), *oldAvatarURL)
	}

	user.AvatarURL = &url
	user.Password = ""
	return user, nil
}
```

Внимание: тело функции всё ещё использует `bytes.NewReader(data)` — `"bytes"` нужно оставить в импортах! Итоговый блок импортов:

```go
import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)
```

Остальная часть файла (`RemoveAvatar`, `randomHex`, все остальные методы `userUseCase`) не меняется.

- [ ] **Step 3: Собрать проект и прогнать существующие тесты аватара**

Run: `cd server && go build ./... && go vet ./...`
Expected: успешно, без ошибок компиляции.

Run: `cd server && go test ./internal/usecase/... -run TestUpdateAvatar -v`
Expected: все 7 тестов (`TestUpdateAvatar_SavesValidPNGAndUpdatesUser`, `..._SavesValidJPEG`, `..._DeletesOldAvatarAfterReplacing`, `..._RejectsUnsupportedFormat`, `..._RejectsCorruptImageData`, `..._RejectsImageBelowMinimumDimensions`, `..._RejectsImageAboveMaximumDimensions`) PASS без изменений — поведение идентично, это чистый рефакторинг.

Run: `cd server && go test ./internal/usecase/... -run TestRemoveAvatar -v`
Expected: оба теста PASS.

- [ ] **Step 4: Коммит**

```bash
git add server/internal/usecase/image.go server/internal/usecase/user.go
git commit -m "refactor(usecase): extract shared image validation helper"
```

---

### Task 2: Backend — новые доменные ошибки

**Files:**
- Modify: `server/internal/domain/errors.go`

**Interfaces:**
- Produces: `domain.ErrServerNotFound`, `domain.ErrLastChannel` — используются в Task 3/4/6/7.

- [ ] **Step 1: Добавить сентинелы**

Заменить содержимое `server/internal/domain/errors.go` на:

```go
package domain

import "errors"

// Доменные сентинел-ошибки. Хендлеры транслируют их в HTTP-статусы через errors.Is.
var (
	// ErrForbidden — пользователь не участник сервера (или не владелец, где это требуется), доступ запрещён.
	ErrForbidden = errors.New("access denied")
	// ErrChannelNotFound — канал с указанным ID не существует.
	ErrChannelNotFound = errors.New("channel not found")
	// ErrMessageNotFound — сообщение с указанным ID не существует или не принадлежит каналу из URL.
	ErrMessageNotFound = errors.New("message not found")
	// ErrInvalidMention — упомянутый через <@uuid> пользователь не состоит в сервере.
	ErrInvalidMention = errors.New("invalid mention")
	// ErrMentionForbidden — @everyone от пользователя без прав owner/admin.
	ErrMentionForbidden = errors.New("mention not allowed")
	// ErrUnsupportedAvatarFormat — загружаемый файл не PNG и не JPEG.
	ErrUnsupportedAvatarFormat = errors.New("unsupported avatar format")
	// ErrInvalidAvatarImage — файл не декодируется как валидное изображение.
	ErrInvalidAvatarImage = errors.New("invalid avatar image")
	// ErrInvalidAvatarDimensions — разрешение изображения вне допустимых границ.
	ErrInvalidAvatarDimensions = errors.New("invalid avatar dimensions")
	// ErrServerNotFound — сервер с указанным ID не существует.
	ErrServerNotFound = errors.New("server not found")
	// ErrLastChannel — попытка удалить единственный оставшийся канал сервера.
	ErrLastChannel = errors.New("cannot delete the last channel of a server")
)
```

- [ ] **Step 2: Собрать проект**

Run: `cd server && go build ./...`
Expected: успешно (новые сентинелы пока нигде не используются, но компилируются).

- [ ] **Step 3: Коммит**

```bash
git add server/internal/domain/errors.go
git commit -m "feat(domain): add ErrServerNotFound and ErrLastChannel sentinels"
```

---

### Task 3: Backend — usecase `UpdateServer`/`DeleteServer` (владелец сервера)

**Files:**
- Modify: `server/internal/domain/usecase.go`
- Modify: `server/internal/usecase/server.go`
- Modify: `server/internal/usecase/server_test.go`
- Modify: `server/cmd/api/main.go`

**Interfaces:**
- Consumes: `domain.ErrServerNotFound`/`domain.ErrLastChannel` (Task 2); `serverRepo.GetByID`/`Update`/`Delete` (уже существуют).
- Produces: `serverUseCase.requireOwner(serverID, userID uuid.UUID) (*domain.Server, error)` — переиспользуется в Task 4/5; `ServerUseCase.UpdateServer(serverID, userID uuid.UUID, name string) (*Server, error)`, `ServerUseCase.DeleteServer(serverID, userID uuid.UUID) error` — используются в Task 6 (HTTP handler); constructor `NewServerUseCase(serverRepo, channelRepo, userRepo, storage filestorage.Storage) domain.ServerUseCase` (сигнатура меняется — 4-й параметр) — используется во всех последующих тасках usecase-слоя и в `main.go`.

- [ ] **Step 1: Расширить `ServerUseCase` интерфейс**

В `server/internal/domain/usecase.go` заменить блок `ServerUseCase`:

```go
type ServerUseCase interface {
	CreateServer(name string, ownerID uuid.UUID) (*Server, error)
	GetServer(id uuid.UUID) (*Server, error)
	GetUserServers(userID uuid.UUID) ([]*Server, error)
	JoinServer(serverID, userID uuid.UUID) error
	LeaveServer(serverID, userID uuid.UUID) error
	SearchServers(query string, limit int) ([]*Server, error)
	CreateChannel(serverID uuid.UUID, name string, channelType ChannelType) (*Channel, error)
	GetChannels(serverID uuid.UUID) ([]*Channel, error)
	GetMembers(serverID, userID uuid.UUID) ([]*MemberWithUser, error)
	UpdateServer(serverID, userID uuid.UUID, name string) (*Server, error)
	DeleteServer(serverID, userID uuid.UUID) error
}
```

Это временно сломает сборку (`serverUseCase` не реализует `UpdateServer`/`DeleteServer`) — исправляется в Step 3.

- [ ] **Step 2: Написать падающие тесты**

В `server/internal/usecase/server_test.go` обновить 3 существующих вызова `usecase.NewServerUseCase(srvRepo, chRepo, usrRepo)` (в `TestGetMembers_Owner_Success`, `TestGetMembers_Member_Success`, `TestGetMembers_NotMember_Forbidden`) — добавить 4-й аргумент. В каждом из трёх тестов, сразу после `usrRepo := new(MockUserRepository)`, добавить строку `storage := new(MockStorage)`, и заменить вызов конструктора на `uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)`.

Затем добавить в конец файла:

```go
func TestUpdateServer_Owner_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, Name: "old"}, nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"name": "new"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateServer(serverID, ownerID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", got.Name)
	srvRepo.AssertCalled(t, "Update", serverID, map[string]interface{}{"name": "new"})
}

func TestUpdateServer_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateServer(serverID, userID, "new")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	srvRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateServer_ServerNotFound(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(nil, fmt.Errorf("server not found"))

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateServer(serverID, userID, "new")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrServerNotFound)
}

func TestDeleteServer_Owner_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	srvRepo.On("Delete", serverID).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	err := uc.DeleteServer(serverID, ownerID)

	assert.NoError(t, err)
	srvRepo.AssertCalled(t, "Delete", serverID)
}

func TestDeleteServer_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	err := uc.DeleteServer(serverID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	srvRepo.AssertNotCalled(t, "Delete", mock.Anything)
}
```

Это использует `fmt` — добавить `"fmt"` в блок импортов `server_test.go`, если его там ещё нет (сейчас там `testing`, `uuid`, `assert`, `mock`, `domain`, `usecase`).

Run: `cd server && go vet ./...`
Expected: FAIL — `usecase.NewServerUseCase` вызывается с 4 аргументами, а конструктор пока принимает 3; `uc.UpdateServer`/`uc.DeleteServer` не существуют.

- [ ] **Step 3: Реализовать `requireOwner`, `UpdateServer`, `DeleteServer`, обновить конструктор**

В `server/internal/usecase/server.go` заменить блок импортов:

```go
import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)
```

Заменить структуру и конструктор:

```go
type serverUseCase struct {
	serverRepo  domain.ServerRepository
	channelRepo domain.ChannelRepository
	userRepo    domain.UserRepository
	storage     filestorage.Storage
}

func NewServerUseCase(
	serverRepo domain.ServerRepository,
	channelRepo domain.ChannelRepository,
	userRepo domain.UserRepository,
	storage filestorage.Storage,
) domain.ServerUseCase {
	return &serverUseCase{
		serverRepo:  serverRepo,
		channelRepo: channelRepo,
		userRepo:    userRepo,
		storage:     storage,
	}
}
```

Добавить в конец файла (после `GetMembers`):

```go
// requireOwner проверяет, что сервер существует и userID — его владелец.
// Возвращает domain.ErrServerNotFound или domain.ErrForbidden.
func (uc *serverUseCase) requireOwner(serverID, userID uuid.UUID) (*domain.Server, error) {
	server, err := uc.serverRepo.GetByID(serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
	}
	if server.OwnerID != userID {
		return nil, domain.ErrForbidden
	}
	return server, nil
}

func (uc *serverUseCase) UpdateServer(serverID, userID uuid.UUID, name string) (*domain.Server, error) {
	server, err := uc.requireOwner(serverID, userID)
	if err != nil {
		return nil, err
	}

	if err := uc.serverRepo.Update(serverID, map[string]interface{}{"name": name}); err != nil {
		return nil, fmt.Errorf("failed to update server: %w", err)
	}

	server.Name = name
	server.UpdatedAt = time.Now()
	return server, nil
}

func (uc *serverUseCase) DeleteServer(serverID, userID uuid.UUID) error {
	if _, err := uc.requireOwner(serverID, userID); err != nil {
		return err
	}

	if err := uc.serverRepo.Delete(serverID); err != nil {
		return fmt.Errorf("failed to delete server: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: Обновить `main.go`**

В `server/cmd/api/main.go:88` заменить:

```go
serverUseCase := usecase.NewServerUseCase(serverRepo, channelRepo, userRepo)
```

на:

```go
serverUseCase := usecase.NewServerUseCase(serverRepo, channelRepo, userRepo, storage)
```

(`storage` уже создан выше, строка 79 — `filestorage.NewLocal(...)`, и используется в `userUseCase` на строке 87.)

- [ ] **Step 5: Тесты, сборка, коммит**

Run: `cd server && go test ./internal/usecase/... -run 'TestUpdateServer|TestDeleteServer|TestGetMembers' -v`
Expected: все тесты (3 старых `GetMembers` + 5 новых) PASS.

Run: `cd server && go build ./... && go vet ./...`
Expected: успешная сборка.

```bash
git add server/internal/domain/usecase.go server/internal/usecase/server.go \
        server/internal/usecase/server_test.go server/cmd/api/main.go
git commit -m "feat(servers): usecase UpdateServer/DeleteServer with owner check"
```

---

### Task 4: Backend — usecase `UpdateChannel`/`DeleteChannel` + защита последнего канала

**Files:**
- Modify: `server/internal/domain/usecase.go`
- Modify: `server/internal/usecase/server.go`
- Modify: `server/internal/usecase/server_test.go`

**Interfaces:**
- Consumes: `uc.requireOwner` (Task 3); `domain.ErrLastChannel`/`domain.ErrChannelNotFound` (Task 2 / уже существует); `channelRepo.GetByID`/`GetByServerID`/`Update`/`Delete` (уже существуют).
- Produces: `ServerUseCase.UpdateChannel(serverID, channelID, userID uuid.UUID, name string) (*Channel, error)`, `ServerUseCase.DeleteChannel(serverID, channelID, userID uuid.UUID) error` — используются в Task 7 (HTTP handler).

- [ ] **Step 1: Расширить интерфейс**

В `server/internal/domain/usecase.go`, в блок `ServerUseCase`, добавить после `DeleteServer`:

```go
	UpdateChannel(serverID, channelID, userID uuid.UUID, name string) (*Channel, error)
	DeleteChannel(serverID, channelID, userID uuid.UUID) error
```

- [ ] **Step 2: Написать падающие тесты**

Добавить в конец `server/internal/usecase/server_test.go`:

```go
func TestUpdateChannel_Owner_Success(t *testing.T) {
	serverID, ownerID, channelID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "old"}, nil)
	chRepo.On("Update", channelID, map[string]interface{}{"name": "new"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "new")

	assert.NoError(t, err)
	assert.Equal(t, "new", got.Name)
}

func TestUpdateChannel_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID, channelID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateChannel(serverID, channelID, userID, "new")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	chRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}

func TestUpdateChannel_WrongServer_NotFound(t *testing.T) {
	serverID, otherServerID, ownerID, channelID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: otherServerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateChannel(serverID, channelID, ownerID, "new")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrChannelNotFound)
	chRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestDeleteChannel_Owner_MultipleChannels_Success(t *testing.T) {
	serverID, ownerID, channelID, otherChannelID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{
		{ID: channelID, ServerID: serverID},
		{ID: otherChannelID, ServerID: serverID},
	}, nil)
	chRepo.On("Delete", channelID).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	err := uc.DeleteChannel(serverID, channelID, ownerID)

	assert.NoError(t, err)
	chRepo.AssertCalled(t, "Delete", channelID)
}

func TestDeleteChannel_LastChannel_Rejected(t *testing.T) {
	serverID, ownerID, channelID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	chRepo.On("GetByServerID", serverID).Return([]*domain.Channel{{ID: channelID, ServerID: serverID}}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	err := uc.DeleteChannel(serverID, channelID, ownerID)

	assert.ErrorIs(t, err, domain.ErrLastChannel)
	chRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteChannel_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID, channelID := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	err := uc.DeleteChannel(serverID, channelID, userID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	chRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}
```

Run: `cd server && go vet ./...`
Expected: FAIL — `uc.UpdateChannel`/`uc.DeleteChannel` не существуют, `serverUseCase` не реализует расширенный интерфейс.

- [ ] **Step 3: Реализовать методы**

Добавить в конец `server/internal/usecase/server.go`:

```go
func (uc *serverUseCase) UpdateChannel(serverID, channelID, userID uuid.UUID, name string) (*domain.Channel, error) {
	if _, err := uc.requireOwner(serverID, userID); err != nil {
		return nil, err
	}

	channel, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return nil, fmt.Errorf("get channel: %w", err)
	}
	if channel.ServerID != serverID {
		return nil, fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound)
	}

	if err := uc.channelRepo.Update(channelID, map[string]interface{}{"name": name}); err != nil {
		return nil, fmt.Errorf("failed to update channel: %w", err)
	}

	channel.Name = name
	channel.UpdatedAt = time.Now()
	return channel, nil
}

func (uc *serverUseCase) DeleteChannel(serverID, channelID, userID uuid.UUID) error {
	if _, err := uc.requireOwner(serverID, userID); err != nil {
		return err
	}

	channel, err := uc.channelRepo.GetByID(channelID)
	if err != nil {
		return fmt.Errorf("get channel: %w", err)
	}
	if channel.ServerID != serverID {
		return fmt.Errorf("channel %s: %w", channelID, domain.ErrChannelNotFound)
	}

	channels, err := uc.channelRepo.GetByServerID(serverID)
	if err != nil {
		return fmt.Errorf("list channels: %w", err)
	}
	if len(channels) <= 1 {
		return domain.ErrLastChannel
	}

	if err := uc.channelRepo.Delete(channelID); err != nil {
		return fmt.Errorf("failed to delete channel: %w", err)
	}
	return nil
}
```

`channelRepo.GetByID` уже возвращает ошибку, оборачивающую `domain.ErrChannelNotFound` (`internal/repository/postgres/channel.go:74-76`) — при несуществующем `channelID` `errors.Is(err, domain.ErrChannelNotFound)` сработает и без ручного оборачивания в этой функции; ручное оборачивание здесь нужно именно для кейса «канал существует, но принадлежит другому серверу» (защита от подмены `server_id` в URL при валидном `channel_id`).

- [ ] **Step 4: Тесты, сборка, коммит**

Run: `cd server && go test ./internal/usecase/... -run 'TestUpdateChannel|TestDeleteChannel' -v`
Expected: все 6 новых тестов PASS.

Run: `cd server && go build ./... && go vet ./...`
Expected: успешная сборка.

```bash
git add server/internal/domain/usecase.go server/internal/usecase/server.go server/internal/usecase/server_test.go
git commit -m "feat(channels): usecase UpdateChannel/DeleteChannel with last-channel guard"
```

---

### Task 5: Backend — usecase `UpdateServerIcon`/`RemoveServerIcon`

**Files:**
- Modify: `server/internal/domain/usecase.go`
- Modify: `server/internal/usecase/server.go`
- Modify: `server/internal/usecase/server_test.go`

**Interfaces:**
- Consumes: `validateImage` (Task 1); `uc.requireOwner` (Task 3); `uc.storage` (`filestorage.Storage`, поле добавлено в Task 3); `randomHex(n int) string` (существует, `server/internal/usecase/user.go`, тот же пакет `usecase` — доступен без изменений).
- Produces: `ServerUseCase.UpdateServerIcon(serverID, userID uuid.UUID, data []byte) (*Server, error)`, `ServerUseCase.RemoveServerIcon(serverID, userID uuid.UUID) (*Server, error)` — используются в Task 8 (HTTP handler).

- [ ] **Step 1: Расширить интерфейс**

В `server/internal/domain/usecase.go`, в блок `ServerUseCase`, добавить после `DeleteChannel`:

```go
	UpdateServerIcon(serverID, userID uuid.UUID, data []byte) (*Server, error)
	RemoveServerIcon(serverID, userID uuid.UUID) (*Server, error)
```

- [ ] **Step 2: Написать падающие тесты**

В `server/internal/usecase/server_test.go` добавить в блок импортов `"strings"` и `"github.com/stretchr/testify/require"` (сейчас там `testing`, `fmt`, `uuid`, `assert`, `mock`, `domain`, `usecase`). Итоговый блок:

```go
import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)
```

Добавить в конец файла (использует `fakePNGBytes` — уже определена в `user_test.go`, тот же пакет `usecase_test`, доступна без переопределения):

```go
func TestUpdateServerIcon_Owner_SavesAndUpdatesURL(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)
	storage.On("Save", mock.Anything, mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "server-icons/"+serverID.String()+"/") && strings.HasSuffix(key, ".png")
	}), mock.Anything, "image/png").Return("/uploads/server-icons/x/y.png", nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"icon_url": "/uploads/server-icons/x/y.png"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateServerIcon(serverID, ownerID, fakePNGBytes(64, 64))

	require.NoError(t, err)
	require.NotNil(t, got.IconURL)
	assert.Equal(t, "/uploads/server-icons/x/y.png", *got.IconURL)
}

func TestUpdateServerIcon_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateServerIcon(serverID, userID, fakePNGBytes(64, 64))

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	storage.AssertNotCalled(t, "Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestUpdateServerIcon_RejectsUnsupportedFormat(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.UpdateServerIcon(serverID, ownerID, []byte("not an image, just plain text bytes"))

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrUnsupportedAvatarFormat)
}

func TestRemoveServerIcon_Owner_ClearsURLAndDeletesFile(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()
	oldURL := "/uploads/server-icons/old.png"

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, IconURL: &oldURL}, nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"icon_url": nil}).Return(nil)
	storage.On("Delete", mock.Anything, oldURL).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.RemoveServerIcon(serverID, ownerID)

	require.NoError(t, err)
	assert.Nil(t, got.IconURL)
	storage.AssertExpectations(t)
}

func TestRemoveServerIcon_NoOpWhenNoIconSet(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.RemoveServerIcon(serverID, ownerID)

	require.NoError(t, err)
	assert.Nil(t, got.IconURL)
	srvRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
	storage.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything)
}

func TestRemoveServerIcon_NotOwner_Forbidden(t *testing.T) {
	serverID, ownerID, userID := uuid.New(), uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	chRepo := new(MockChannelRepository)
	usrRepo := new(MockUserRepository)
	storage := new(MockStorage)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID}, nil)

	uc := usecase.NewServerUseCase(srvRepo, chRepo, usrRepo, storage)
	got, err := uc.RemoveServerIcon(serverID, userID)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}
```

Run: `cd server && go vet ./...`
Expected: FAIL — `uc.UpdateServerIcon`/`uc.RemoveServerIcon` не существуют.

- [ ] **Step 3: Реализовать методы**

Добавить в конец `server/internal/usecase/server.go` (использует `bytes.NewReader` и `context.Background()` — добавить `"bytes"` и `"context"` в блок импортов файла, рядом с `"fmt"`/`"time"`):

```go
import (
	"bytes"
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)
```

```go
// UpdateServerIcon валидирует data как PNG/JPEG, сохраняет файл, обновляет
// icon_url сервера и удаляет старый файл иконки (best-effort — как у
// UpdateAvatar, орфан-файл не хуже жёсткого фейла запроса).
func (uc *serverUseCase) UpdateServerIcon(serverID, userID uuid.UUID, data []byte) (*domain.Server, error) {
	server, err := uc.requireOwner(serverID, userID)
	if err != nil {
		return nil, err
	}

	ext, contentType, err := validateImage(data)
	if err != nil {
		return nil, err
	}

	oldIconURL := server.IconURL

	key := fmt.Sprintf("server-icons/%s/%s.%s", serverID, randomHex(8), ext)
	url, err := uc.storage.Save(context.Background(), key, bytes.NewReader(data), contentType)
	if err != nil {
		return nil, fmt.Errorf("save server icon: %w", err)
	}

	if err := uc.serverRepo.Update(serverID, map[string]interface{}{"icon_url": url}); err != nil {
		return nil, fmt.Errorf("update server icon url: %w", err)
	}

	if oldIconURL != nil {
		_ = uc.storage.Delete(context.Background(), *oldIconURL)
	}

	server.IconURL = &url
	return server, nil
}

// RemoveServerIcon очищает icon_url сервера и удаляет файл. No-op, если
// иконка уже не установлена.
func (uc *serverUseCase) RemoveServerIcon(serverID, userID uuid.UUID) (*domain.Server, error) {
	server, err := uc.requireOwner(serverID, userID)
	if err != nil {
		return nil, err
	}

	if server.IconURL == nil {
		return server, nil
	}

	oldIconURL := *server.IconURL
	if err := uc.serverRepo.Update(serverID, map[string]interface{}{"icon_url": nil}); err != nil {
		return nil, fmt.Errorf("clear server icon url: %w", err)
	}
	_ = uc.storage.Delete(context.Background(), oldIconURL)

	server.IconURL = nil
	return server, nil
}
```

- [ ] **Step 4: Тесты, сборка, коммит**

Run: `cd server && go test ./internal/usecase/... -run 'TestUpdateServerIcon|TestRemoveServerIcon' -v`
Expected: все 6 новых тестов PASS.

Run: `cd server && go test ./internal/usecase/... && go build ./... && go vet ./...`
Expected: весь пакет `usecase` PASS, сборка успешна.

```bash
git add server/internal/domain/usecase.go server/internal/usecase/server.go server/internal/usecase/server_test.go
git commit -m "feat(servers): usecase UpdateServerIcon/RemoveServerIcon"
```

---

### Task 6: Backend — HTTP `PATCH`/`DELETE /api/v1/servers/{id}` + WS `server_update`/`server_delete`

**Files:**
- Modify: `server/internal/delivery/http/handler/server.go`
- Modify: `server/cmd/api/main.go`

**Interfaces:**
- Consumes: `domain.ServerUseCase.UpdateServer`/`DeleteServer` (Task 3); `ws.Hub.BroadcastMessage(message *ws.Message)` (существует, `internal/delivery/ws/hub.go:366-368`); `ws.Message{Type string, Payload json.RawMessage}` (существует); `middleware.RequestIDFromContext(ctx) string` (существует, используется в `message.go`).
- Produces: HTTP `PATCH/DELETE /api/v1/servers/{id}`; WS-события `server_update` (payload — полный `domain.Server` JSON) и `server_delete` (payload — `{"id":"..."}`); `ServerHandler.writeUseCaseError` — переиспользуется в Task 7/8.

- [ ] **Step 1: Добавить `hub` в `ServerHandler`**

В `server/internal/delivery/http/handler/server.go` заменить блок импортов:

```go
import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)
```

Заменить структуру и конструктор:

```go
type ServerHandler struct {
	serverUseCase domain.ServerUseCase
	hub           *ws.Hub
	log           *slog.Logger
}

func NewServerHandler(serverUseCase domain.ServerUseCase, hub *ws.Hub, log *slog.Logger) *ServerHandler {
	return &ServerHandler{
		serverUseCase: serverUseCase,
		hub:           hub,
		log:           log,
	}
}
```

- [ ] **Step 2: Добавить `UpdateServer`/`DeleteServer` хендлеры + `writeUseCaseError`**

Добавить в `server/internal/delivery/http/handler/server.go`, после `LeaveServer` (перед `type CreateChannelRequest struct`):

```go
type UpdateServerRequest struct {
	Name string `json:"name"`
}

func (h *ServerHandler) UpdateServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	var req UpdateServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		h.sendError(w, http.StatusBadRequest, "server name is required")
		return
	}

	server, err := h.serverUseCase.UpdateServer(serverID, userID, req.Name)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(server)
	h.hub.BroadcastMessage(&ws.Message{Type: "server_update", Payload: payload})

	h.sendJSON(w, http.StatusOK, server)
}

type deleteServerPayload struct {
	ID uuid.UUID `json:"id"`
}

func (h *ServerHandler) DeleteServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	if err := h.serverUseCase.DeleteServer(serverID, userID); err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(deleteServerPayload{ID: serverID})
	h.hub.BroadcastMessage(&ws.Message{Type: "server_delete", Payload: payload})

	w.WriteHeader(http.StatusNoContent)
}
```

Добавить в конец файла, перед `sendJSON`/`sendError`:

```go
// writeUseCaseError транслирует доменные ошибки usecase-слоя серверов/каналов
// в HTTP-статусы, не раскрывая внутренние детали (err.Error()) наружу.
func (h *ServerHandler) writeUseCaseError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrServerNotFound):
		h.sendError(w, http.StatusNotFound, "server not found")
	case errors.Is(err, domain.ErrChannelNotFound):
		h.sendError(w, http.StatusNotFound, "channel not found")
	case errors.Is(err, domain.ErrLastChannel):
		h.sendError(w, http.StatusBadRequest, "cannot delete the last channel of a server")
	case errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, "access denied")
	case errors.Is(err, domain.ErrUnsupportedAvatarFormat):
		h.sendError(w, http.StatusBadRequest, "unsupported format: only PNG and JPEG are allowed")
	case errors.Is(err, domain.ErrInvalidAvatarImage):
		h.sendError(w, http.StatusBadRequest, "invalid image file")
	case errors.Is(err, domain.ErrInvalidAvatarDimensions):
		h.sendError(w, http.StatusBadRequest, "image dimensions are out of allowed range")
	default:
		h.log.Error("server request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, "internal server error")
	}
}
```

- [ ] **Step 3: Обновить конструкцию хендлера и зарегистрировать роуты в `main.go`**

В `server/cmd/api/main.go:100` заменить:

```go
serverHandler := handler.NewServerHandler(serverUseCase, log)
```

на:

```go
serverHandler := handler.NewServerHandler(serverUseCase, hub, log)
```

(`hub` уже создан на строке 94, до этой строки — порядок инициализации менять не нужно.)

В блоке `// Server routes` (после строки `router.HandleFunc("POST /api/v1/servers/{id}/leave", ...)`) добавить:

```go
router.HandleFunc("PATCH /api/v1/servers/{id}", authMid.RequireAuth(serverHandler.UpdateServer))
router.HandleFunc("DELETE /api/v1/servers/{id}", authMid.RequireAuth(serverHandler.DeleteServer))
```

- [ ] **Step 4: Собрать проект**

Run: `cd server && go build ./... && go vet ./...`
Expected: успешная сборка, без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add server/internal/delivery/http/handler/server.go server/cmd/api/main.go
git commit -m "feat(servers): PATCH/DELETE endpoints + server_update/server_delete WS broadcast"
```

---

### Task 7: Backend — HTTP `PATCH`/`DELETE .../channels/{channel_id}` + WS `channel_update`/`channel_delete`

**Files:**
- Modify: `server/internal/delivery/http/handler/server.go`
- Modify: `server/cmd/api/main.go`

**Interfaces:**
- Consumes: `domain.ServerUseCase.UpdateChannel`/`DeleteChannel` (Task 4); `h.hub.BroadcastMessage`, `h.writeUseCaseError` (Task 6).
- Produces: HTTP `PATCH/DELETE /api/v1/servers/{server_id}/channels/{channel_id}`; WS-события `channel_update` (payload — полный `domain.Channel` JSON) и `channel_delete` (payload — `{"id":"...","server_id":"..."}`).

- [ ] **Step 1: Добавить хендлеры**

Добавить в `server/internal/delivery/http/handler/server.go`, после `GetChannels`:

```go
type UpdateChannelRequest struct {
	Name string `json:"name"`
}

func (h *ServerHandler) UpdateChannel(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	serverID, err := uuid.Parse(r.PathValue("server_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	var req UpdateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		h.sendError(w, http.StatusBadRequest, "channel name is required")
		return
	}

	channel, err := h.serverUseCase.UpdateChannel(serverID, channelID, userID, req.Name)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(channel)
	h.hub.BroadcastMessage(&ws.Message{Type: "channel_update", Payload: payload})

	h.sendJSON(w, http.StatusOK, channel)
}

type deleteChannelPayload struct {
	ID       uuid.UUID `json:"id"`
	ServerID uuid.UUID `json:"server_id"`
}

func (h *ServerHandler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	serverID, err := uuid.Parse(r.PathValue("server_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid channel id")
		return
	}

	if err := h.serverUseCase.DeleteChannel(serverID, channelID, userID); err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(deleteChannelPayload{ID: channelID, ServerID: serverID})
	h.hub.BroadcastMessage(&ws.Message{Type: "channel_delete", Payload: payload})

	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 2: Зарегистрировать роуты**

В `server/cmd/api/main.go`, в блоке `// Channel routes` (после `GET .../channels`), добавить:

```go
router.HandleFunc("PATCH /api/v1/servers/{server_id}/channels/{channel_id}", authMid.RequireAuth(serverHandler.UpdateChannel))
router.HandleFunc("DELETE /api/v1/servers/{server_id}/channels/{channel_id}", authMid.RequireAuth(serverHandler.DeleteChannel))
```

- [ ] **Step 3: Собрать проект**

Run: `cd server && go build ./... && go vet ./...`
Expected: успешная сборка.

- [ ] **Step 4: Коммит**

```bash
git add server/internal/delivery/http/handler/server.go server/cmd/api/main.go
git commit -m "feat(channels): PATCH/DELETE endpoints + channel_update/channel_delete WS broadcast"
```

---

### Task 8: Backend — HTTP `POST`/`DELETE /api/v1/servers/{id}/icon`

**Files:**
- Modify: `server/internal/delivery/http/handler/server.go`
- Modify: `server/cmd/api/main.go`

**Interfaces:**
- Consumes: `domain.ServerUseCase.UpdateServerIcon`/`RemoveServerIcon` (Task 5); `h.hub.BroadcastMessage`, `h.writeUseCaseError` (Task 6).
- Produces: HTTP `POST /api/v1/servers/{id}/icon` (multipart, поле `"icon"`), `DELETE /api/v1/servers/{id}/icon`; переиспользует WS-событие `server_update` (Task 6).

- [ ] **Step 1: Добавить хендлеры**

Добавить `"io"` в блок импортов `server/internal/delivery/http/handler/server.go`:

```go
import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)
```

Добавить в конец файла, перед `writeUseCaseError`:

```go
const (
	// maxServerIconRequestBytes ограничивает multipart-запрос целиком — чуть
	// больше maxServerIconFileBytes, чтобы оставить место под границы/заголовки.
	maxServerIconRequestBytes = 3 << 20
	// maxServerIconFileBytes — лимит на сам файл иконки.
	maxServerIconFileBytes = 2 << 20
)

// UploadServerIcon принимает multipart/form-data с полем "icon" (PNG/JPEG,
// ≤2MB), сохраняет его, обновляет icon_url сервера и рассылает server_update.
func (h *ServerHandler) UploadServerIcon(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxServerIconRequestBytes)
	if err := r.ParseMultipartForm(maxServerIconRequestBytes); err != nil {
		h.sendError(w, http.StatusRequestEntityTooLarge, "icon file is too large")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, _, err := r.FormFile("icon")
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "icon file is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxServerIconFileBytes+1))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "failed to read icon file")
		return
	}
	if len(data) > maxServerIconFileBytes {
		h.sendError(w, http.StatusRequestEntityTooLarge, "icon file is too large")
		return
	}

	server, err := h.serverUseCase.UpdateServerIcon(serverID, userID, data)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(server)
	h.hub.BroadcastMessage(&ws.Message{Type: "server_update", Payload: payload})

	h.sendJSON(w, http.StatusOK, server)
}

// RemoveServerIcon очищает иконку сервера и рассылает server_update.
func (h *ServerHandler) RemoveServerIcon(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid server id")
		return
	}

	server, err := h.serverUseCase.RemoveServerIcon(serverID, userID)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(server)
	h.hub.BroadcastMessage(&ws.Message{Type: "server_update", Payload: payload})

	h.sendJSON(w, http.StatusOK, server)
}
```

- [ ] **Step 2: Зарегистрировать роуты**

В `server/cmd/api/main.go`, в блоке `// Server routes`, добавить (рядом с `PATCH/DELETE /api/v1/servers/{id}` из Task 6):

```go
router.HandleFunc("POST /api/v1/servers/{id}/icon", authMid.RequireAuth(serverHandler.UploadServerIcon))
router.HandleFunc("DELETE /api/v1/servers/{id}/icon", authMid.RequireAuth(serverHandler.RemoveServerIcon))
```

- [ ] **Step 3: Собрать проект, прогнать весь backend-набор тестов**

Run: `cd server && go build ./... && go vet ./...`
Expected: успешная сборка.

Run: `cd server && go test ./...`
Expected: все пакеты PASS (это финальная проверка всего backend-слоя перед переходом к фронтенду).

- [ ] **Step 4: Коммит**

```bash
git add server/internal/delivery/http/handler/server.go server/cmd/api/main.go
git commit -m "feat(servers): icon upload/remove endpoints"
```

---

### Task 9: Frontend — `api.ts`: методы для сервера/канала

**Files:**
- Modify: `client/src/services/api.ts`

**Interfaces:**
- Consumes: `ApiService.request<T>`/`requestForm<T>` (существуют).
- Produces: `apiService.updateServer(id, name)`, `apiService.deleteServer(id)`, `apiService.uploadServerIcon(id, blob)`, `apiService.removeServerIcon(id)`, `apiService.updateChannel(serverId, channelId, name)`, `apiService.deleteChannel(serverId, channelId)` — используются в Task 12/13.

- [ ] **Step 1: Добавить импорт типа `Server`**

Заменить строку 2:

```ts
import type { Server, User } from '@/types';
```

- [ ] **Step 2: Добавить методы сервера**

После `leaveServer` (в секции `// Servers`) добавить:

```ts
  async updateServer(id: string, name: string) {
    return this.request(`/api/v1/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  async deleteServer(id: string) {
    return this.request(`/api/v1/servers/${id}`, {
      method: 'DELETE',
    });
  }

  async uploadServerIcon(id: string, blob: Blob) {
    const formData = new FormData();
    formData.append('icon', blob, 'icon.jpg');
    return this.requestForm<Server>(`/api/v1/servers/${id}/icon`, {
      method: 'POST',
      body: formData,
    });
  }

  async removeServerIcon(id: string) {
    return this.requestForm<Server>(`/api/v1/servers/${id}/icon`, {
      method: 'DELETE',
    });
  }
```

- [ ] **Step 3: Добавить методы канала**

После `getServerMembers` (в секции `// Channels`) добавить:

```ts
  async updateChannel(serverId: string, channelId: string, name: string) {
    return this.request(`/api/v1/servers/${serverId}/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  async deleteChannel(serverId: string, channelId: string) {
    return this.request(`/api/v1/servers/${serverId}/channels/${channelId}`, {
      method: 'DELETE',
    });
  }
```

- [ ] **Step 4: Типчек**

Run: `cd client && npx tsc --noEmit`
Expected: без новых ошибок.

- [ ] **Step 5: Коммит**

```bash
git add client/src/services/api.ts
git commit -m "feat(servers): api client methods for server/channel update/delete"
```

---

### Task 10: Frontend — `serverStore.ts`: `patchServer`/`removeServer`/`patchChannel`/`removeChannel`

**Files:**
- Modify: `client/src/stores/serverStore.ts`

**Interfaces:**
- Produces: `useServerStore().patchServer(id, patch)`, `.removeServer(id)`, `.patchChannel(id, patch)`, `.removeChannel(id)` — используются в Task 12/13/14.

- [ ] **Step 1: Расширить store**

Заменить содержимое `client/src/stores/serverStore.ts` на:

```ts
import { create } from 'zustand';
import type { Server, Channel, MemberWithUser } from '@/types';

interface ServerState {
  servers: Server[];
  currentServer: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  members: MemberWithUser[];
  setServers: (servers: Server[]) => void;
  setCurrentServer: (server: Server | null) => void;
  setChannels: (channels: Channel[]) => void;
  setCurrentChannel: (channel: Channel | null) => void;
  setMembers: (members: MemberWithUser[]) => void;
  patchMemberAvatar: (userId: string, avatarUrl: string | null) => void;
  patchServer: (id: string, patch: Partial<Server>) => void;
  removeServer: (id: string) => void;
  patchChannel: (id: string, patch: Partial<Channel>) => void;
  removeChannel: (id: string) => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  currentServer: null,
  channels: [],
  currentChannel: null,
  members: [],

  setServers: (servers) => set({ servers }),
  setCurrentServer: (server) => set({ currentServer: server }),
  setChannels: (channels) => set({ channels }),
  setCurrentChannel: (channel) => set({ currentChannel: channel }),
  setMembers: (members) => set({ members }),
  patchMemberAvatar: (userId, avatarUrl) =>
    set((state) => ({
      members: state.members.map((m) =>
        m.user_id === userId ? { ...m, avatar_url: avatarUrl ?? undefined } : m
      ),
    })),
  patchServer: (id, patch) =>
    set((state) => ({
      servers: state.servers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      currentServer:
        state.currentServer?.id === id ? { ...state.currentServer, ...patch } : state.currentServer,
    })),
  removeServer: (id) =>
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== id),
    })),
  patchChannel: (id, patch) =>
    set((state) => ({
      channels: state.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      currentChannel:
        state.currentChannel?.id === id ? { ...state.currentChannel, ...patch } : state.currentChannel,
    })),
  removeChannel: (id) =>
    set((state) => ({
      channels: state.channels.filter((c) => c.id !== id),
    })),
}));
```

- [ ] **Step 2: Типчек**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Коммит**

```bash
git add client/src/stores/serverStore.ts
git commit -m "feat(servers): store actions patchServer/removeServer/patchChannel/removeChannel"
```

---

### Task 11: Frontend — компонент `ContextMenu`

**Files:**
- Create: `client/src/components/ContextMenu.tsx`
- Create: `client/src/components/ContextMenu.css`

**Interfaces:**
- Produces: `<ContextMenu x={number} y={number} items={ContextMenuItem[]} onClose={() => void} />`, тип `ContextMenuItem { label: string; onClick: () => void; danger?: boolean; disabled?: boolean; disabledReason?: string }` — используются в Task 12/13.

- [ ] **Step 1: Создать `client/src/components/ContextMenu.tsx`**

Паттерн клика-вне/Escape/портала — тот же, что в `client/src/components/VolumeControlPopover.tsx` (уже есть в кодовой базе):

```tsx
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const clampedX = Math.min(x, window.innerWidth - 200);
  const clampedY = Math.min(y, window.innerHeight - items.length * 36 - 16);

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`context-menu-item ${item.danger ? 'danger' : ''}`}
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Создать `client/src/components/ContextMenu.css`**

```css
.context-menu {
  position: fixed;
  z-index: 1050;
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 6px;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  animation: scaleIn 0.12s var(--ease-out);
}

.context-menu-item {
  background: none;
  border: none;
  text-align: left;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition);
}

.context-menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.context-menu-item.danger {
  color: var(--red-500);
}

.context-menu-item.danger:hover:not(:disabled) {
  background: var(--red-50);
}

.context-menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

`scaleIn` keyframes уже определены глобально в `client/src/pages/AppPage.css:44-47` — переиспользуются как есть (это plain CSS, не CSS-модули, все стили в проекте общие глобально).

- [ ] **Step 3: Типчек**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок (компонент пока нигде не используется, но должен компилироваться сам по себе).

- [ ] **Step 4: Коммит**

```bash
git add client/src/components/ContextMenu.tsx client/src/components/ContextMenu.css
git commit -m "feat(ui): generic ContextMenu component"
```

---

### Task 12: Frontend — `ServerList.tsx`: контекстное меню + `EditServerModal` (название + иконка)

**Files:**
- Modify: `client/src/components/ServerList.tsx`
- Modify: `client/src/components/AvatarCropModal.tsx`
- Modify: `client/src/pages/AppPage.css`
- Create: `client/src/components/EditServerModal.tsx`
- Create: `client/src/components/EditServerModal.css`

**Interfaces:**
- Consumes: `ContextMenu`/`ContextMenuItem` (Task 11); `apiService.updateServer`/`uploadServerIcon`/`removeServerIcon`/`deleteServer` (Task 9); `useServerStore().patchServer`/`removeServer` (Task 10); `AvatarCropModal` (существует, расширяется этим таском).
- Produces: `<ServerList ... user={User | null} onServerDeleted={(serverId: string) => void} />` — новые обязательные пропсы, используются в Task 14 (`AppPage.tsx`).

- [ ] **Step 1: Добавить `title` в `AvatarCropModal`**

В `client/src/components/AvatarCropModal.tsx` заменить интерфейс пропсов:

```tsx
interface AvatarCropModalProps {
  file: File;
  title?: string;
  onCancel: () => void;
  onUpload: (blob: Blob) => Promise<void>;
}
```

Заменить сигнатуру функции:

```tsx
export function AvatarCropModal({ file, title, onCancel, onUpload }: AvatarCropModalProps) {
```

Заменить `<h3>Обрезка аватара</h3>` на:

```tsx
<h3>{title ?? 'Обрезка аватара'}</h3>
```

Существующий вызов из `client/src/components/settings/ProfileSettings.tsx` (`<AvatarCropModal file={cropFile} onCancel={...} onUpload={handleUpload} />`) не передаёт `title` — он опциональный, поведение не меняется.

- [ ] **Step 2: Добавить `.modal-error` в `client/src/pages/AppPage.css`**

После блока `.modal-actions button.primary:hover` (после `box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);\n}`) добавить:

```css
.modal-error {
  color: var(--red-500);
  font-size: 13px;
  margin-top: -8px;
  margin-bottom: 12px;
}
```

(Переиспользуется и `EditServerModal`, и `EditChannelModal` из Task 13 — размещаем в `AppPage.css`, потому что это единственный CSS-файл, гарантированно загруженный до рендера любой модалки: `AppPage.tsx` — корневая страница.)

- [ ] **Step 3: Создать `client/src/components/EditServerModal.css`**

```css
.edit-server-icon-block {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.edit-server-icon-preview {
  width: 72px;
  height: 72px;
  min-width: 72px;
  border-radius: var(--radius-full);
  object-fit: cover;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--brand-300), var(--brand-500));
  color: var(--text-inverse);
}

.edit-server-icon-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-server-icon-btn {
  padding: 7px 14px;
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition);
}

.edit-server-icon-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.edit-server-icon-btn.danger {
  color: var(--red-500);
  border-color: var(--red-500);
}

.edit-server-icon-btn.danger:hover:not(:disabled) {
  background: var(--red-50);
}

.edit-server-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 4: Создать `client/src/components/EditServerModal.tsx`**

```tsx
import { useRef, useState } from 'react';
import type { Server } from '@/types';
import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { AvatarCropModal } from '@/components/AvatarCropModal';
import './EditServerModal.css';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface EditServerModalProps {
  server: Server;
  onClose: () => void;
}

export function EditServerModal({ server, onClose }: EditServerModalProps) {
  const [name, setName] = useState(server.name);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingIcon, setRemovingIcon] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Неподдерживаемый формат. Разрешены PNG, JPG, JPEG');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('Файл слишком большой. Максимум 2 МБ');
      return;
    }
    setError(null);
    setCropFile(file);
  };

  const handleUploadIcon = async (blob: Blob): Promise<void> => {
    const updated = (await apiService.uploadServerIcon(server.id, blob)) as Server;
    useServerStore.getState().patchServer(server.id, { icon_url: updated.icon_url });
    setCropFile(null);
  };

  const handleRemoveIcon = async () => {
    setRemovingIcon(true);
    try {
      const updated = (await apiService.removeServerIcon(server.id)) as Server;
      useServerStore.getState().patchServer(server.id, { icon_url: updated.icon_url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить иконку');
    } finally {
      setRemovingIcon(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === server.name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = (await apiService.updateServer(server.id, name.trim())) as Server;
      useServerStore.getState().patchServer(server.id, { name: updated.name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить сервер');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Редактировать сервер</h2>

        <div className="edit-server-icon-block">
          {server.icon_url ? (
            <img src={server.icon_url} alt={server.name} className="edit-server-icon-preview" />
          ) : (
            <div className="edit-server-icon-preview">{server.name.charAt(0).toUpperCase()}</div>
          )}
          <div className="edit-server-icon-actions">
            <button
              type="button"
              className="edit-server-icon-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Изменить иконку
            </button>
            {server.icon_url && (
              <button
                type="button"
                className="edit-server-icon-btn danger"
                onClick={handleRemoveIcon}
                disabled={removingIcon}
              >
                {removingIcon ? 'Удаление...' : 'Удалить иконку'}
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-server-name">Название сервера</label>
            <input
              id="edit-server-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              required
            />
          </div>
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          title="Обрезка иконки сервера"
          onCancel={() => setCropFile(null)}
          onUpload={handleUploadIcon}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Подключить контекстное меню и модалку в `ServerList.tsx`**

Заменить блок импортов:

```tsx
import { useState } from 'react';
import type { Server, User } from '@/types';
import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { ContextMenu } from '@/components/ContextMenu';
import { EditServerModal } from '@/components/EditServerModal';
import './ServerList.css';
```

Заменить интерфейс пропсов и сигнатуру функции:

```tsx
interface ServerListProps {
  servers: Server[];
  currentServer: Server | null;
  user: User | null;
  onSelectServer: (server: Server) => void;
  onCreateServer: () => void;
  onJoinServer: (server: Server) => void;
  onServerDeleted: (serverId: string) => void;
}

export function ServerList({
  servers,
  currentServer,
  user,
  onSelectServer,
  onCreateServer,
  onJoinServer,
  onServerDeleted,
}: ServerListProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Server[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; server: Server } | null>(null);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
```

Добавить перед `handleSearch` (или сразу после него):

```tsx
  const handleDeleteServer = async (server: Server) => {
    if (!window.confirm(`Удалить сервер «${server.name}»? Это действие необратимо.`)) return;
    try {
      await apiService.deleteServer(server.id);
      useServerStore.getState().removeServer(server.id);
      onServerDeleted(server.id);
    } catch (err) {
      console.error('Failed to delete server:', err);
      alert(err instanceof Error ? err.message : 'Не удалось удалить сервер');
    }
  };
```

Заменить рендер серверов (`{servers.map((server) => (...))}`) — добавить `onContextMenu` на `.server-icon`:

```tsx
        {servers.map((server) => (
          <div
            key={server.id}
            className={`server-icon ${currentServer?.id === server.id ? 'active' : ''}`}
            onClick={() => onSelectServer(server)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (server.owner_id !== user?.id) return;
              setMenu({ x: e.clientX, y: e.clientY, server });
            }}
            title={server.name}
          >
            {server.icon_url ? (
              <img src={server.icon_url} alt={server.name} />
            ) : (
              <span className="server-icon-symbol">{server.name.charAt(0).toUpperCase()}</span>
            )}
            <span className="server-icon-name">{server.name}</span>
          </div>
        ))}
```

Добавить перед закрывающим `</>` (после блока `{searchOpen && (...)}`):

```tsx
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Редактировать', onClick: () => setEditingServer(menu.server) },
            { label: 'Удалить сервер', danger: true, onClick: () => handleDeleteServer(menu.server) },
          ]}
        />
      )}

      {editingServer && (
        <EditServerModal server={editingServer} onClose={() => setEditingServer(null)} />
      )}
```

- [ ] **Step 6: Типчек**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок — компилируется, но `ServerList` пока не получает новые пропсы из `AppPage.tsx` (это Task 14), так что на этом шаге `AppPage.tsx` временно не типизируется корректно. Это ожидаемо и **не блокирует** этот таск — коммит делаем всё равно, финальный `tsc --noEmit` по всему проекту прогоняется в Task 14.

Run: `cd client && npx tsc --noEmit 2>&1 | grep ServerList.tsx`
Expected: пусто (сам файл `ServerList.tsx` без ошибок типов).

- [ ] **Step 7: Коммит**

```bash
git add client/src/components/ServerList.tsx client/src/components/AvatarCropModal.tsx \
        client/src/components/EditServerModal.tsx client/src/components/EditServerModal.css \
        client/src/pages/AppPage.css
git commit -m "feat(servers): edit/delete context menu + EditServerModal on ServerList"
```

---

### Task 13: Frontend — `ChannelSidebar.tsx`: контекстное меню + `EditChannelModal` (название)

**Files:**
- Modify: `client/src/components/ChannelSidebar.tsx`
- Create: `client/src/components/EditChannelModal.tsx`

**Interfaces:**
- Consumes: `ContextMenu`/`ContextMenuItem` (Task 11); `apiService.updateChannel`/`deleteChannel` (Task 9); `useServerStore().patchChannel`/`removeChannel` (Task 10).
- Produces: `<ChannelSidebar ... onChannelDeleted={(channelId: string) => void} />` — новый обязательный проп, используется в Task 14.

- [ ] **Step 1: Создать `client/src/components/EditChannelModal.tsx`**

Название канала — только текст, без иконки; переиспользует глобальные `.modal`/`.modal-overlay`/`.form-group`/`.modal-error` (последний добавлен в Task 12, Step 2), новый CSS-файл не нужен.

```tsx
import { useState } from 'react';
import type { Channel } from '@/types';
import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';

interface EditChannelModalProps {
  serverId: string;
  channel: Channel;
  onClose: () => void;
}

export function EditChannelModal({ serverId, channel, onClose }: EditChannelModalProps) {
  const [name, setName] = useState(channel.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === channel.name) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = (await apiService.updateChannel(serverId, channel.id, name.trim())) as Channel;
      useServerStore.getState().patchChannel(channel.id, { name: updated.name });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось обновить канал');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Редактировать канал</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="edit-channel-name">Название канала</label>
            <input
              id="edit-channel-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              required
            />
          </div>
          {error && <p className="modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Подключить в `ChannelSidebar.tsx`**

Заменить блок импортов:

```tsx
import { useState, useEffect, useMemo } from 'react';
import type { Server, Channel, User, MemberWithUser } from '@/types';
import { Settings } from '@/components/Settings';
import { Avatar } from '@/components/Avatar';
import { ContextMenu } from '@/components/ContextMenu';
import { EditChannelModal } from '@/components/EditChannelModal';
import { apiService } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { noiseCancellationService } from '@/services/noiseCancellation';
import './ChannelSidebar.css';
```

Заменить интерфейс пропсов, добавив `onChannelDeleted`:

```tsx
interface ChannelSidebarProps {
  server: Server | null;
  channels: Channel[];
  currentChannel: Channel | null;
  onSelectChannel: (channel: Channel) => void;
  user: User | null;
  onLogout: () => void;
  onMobileBack?: () => void;
  voiceParticipants?: Map<string, string[]>;
  members: MemberWithUser[];
  onChannelDeleted: (channelId: string) => void;
}
```

Добавить в деструктуризацию пропсов функции `ChannelSidebar` параметр `onChannelDeleted`, и после `const [ncEnabled, setNcEnabled] = useState(false);` добавить:

```tsx
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);

  const handleDeleteChannel = async (channel: Channel) => {
    if (!server) return;
    if (channels.length <= 1) return;
    if (!window.confirm(`Удалить канал «${channel.name}»?`)) return;
    try {
      await apiService.deleteChannel(server.id, channel.id);
      useServerStore.getState().removeChannel(channel.id);
      onChannelDeleted(channel.id);
    } catch (err) {
      console.error('Failed to delete channel:', err);
      alert(err instanceof Error ? err.message : 'Не удалось удалить канал');
    }
  };
```

В рендере текстовых каналов добавить `onContextMenu` на `.channel`:

```tsx
            {textChannels.map((channel) => (
              <div
                key={channel.id}
                className={`channel ${currentChannel?.id === channel.id ? 'active' : ''}`}
                onClick={() => onSelectChannel(channel)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (server?.owner_id !== user?.id) return;
                  setChannelMenu({ x: e.clientX, y: e.clientY, channel });
                }}
              >
                {channel.name}
              </div>
            ))}
```

В рендере голосовых каналов добавить тот же `onContextMenu` на внутренний `.channel.voice` div:

```tsx
                  <div
                    className={`channel voice ${currentChannel?.id === channel.id ? 'active' : ''}`}
                    onClick={() => onSelectChannel(channel)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (server?.owner_id !== user?.id) return;
                      setChannelMenu({ x: e.clientX, y: e.clientY, channel });
                    }}
                  >
```

Перед закрывающим `<Settings .../>` в конце JSX (после `</nav>` открывающих тегов — фактически как соседние элементы `<nav>...</nav>`, `<Settings .../>` уже стоит вне `<nav>`) добавить рядом с `<Settings isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />`:

```tsx
      {channelMenu && (
        <ContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          onClose={() => setChannelMenu(null)}
          items={[
            { label: 'Редактировать', onClick: () => setEditingChannel(channelMenu.channel) },
            {
              label: 'Удалить канал',
              danger: true,
              disabled: channels.length <= 1,
              disabledReason: 'Нельзя удалить последний канал сервера',
              onClick: () => handleDeleteChannel(channelMenu.channel),
            },
          ]}
        />
      )}

      {editingChannel && server && (
        <EditChannelModal
          serverId={server.id}
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
        />
      )}
```

Обе ветки JSX (`if (!server) { return (...) }` и основной `return (...)`) должны получить эти два блока — проще всего добавить их сразу после `<Settings .../>` внутри основного `return`, а для ветки `!server` они не нужны (там нет каналов и меню не может открыться).

- [ ] **Step 3: Типчек**

Run: `cd client && npx tsc --noEmit 2>&1 | grep ChannelSidebar.tsx`
Expected: пусто (сам файл без ошибок типов; `AppPage.tsx` пока не передаёт `onChannelDeleted` — это ожидаемо до Task 14).

- [ ] **Step 4: Коммит**

```bash
git add client/src/components/ChannelSidebar.tsx client/src/components/EditChannelModal.tsx
git commit -m "feat(channels): edit/delete context menu + EditChannelModal on ChannelSidebar"
```

---

### Task 14: Frontend — `AppPage.tsx`: пропсы, WS-подписки, навигация при удалении

**Files:**
- Modify: `client/src/pages/AppPage.tsx`

**Interfaces:**
- Consumes: `ServerList` (Task 12, новые пропсы `user`/`onServerDeleted`), `ChannelSidebar` (Task 13, новый проп `onChannelDeleted`), `useServerStore().patchServer/removeServer/patchChannel/removeChannel` (Task 10), `wsService.on` (существует), `groupCallService.isInGroupCallState`/`currentRoomIdState` (существуют, `client/src/services/groupCall.ts:719-720`), `window.leaveGroupCall` (существует, регистрируется в `GroupCallUI.tsx:856`).
- Produces: конечная сквозная интеграция — рабочее редактирование/удаление сервера/канала с live-синхронизацией у всех подключённых клиентов.

- [ ] **Step 1: Добавить типы `Server`/`Channel` в WS-обработчики и хелперы навигации**

После блока `const loadServerMembers = ...` (перед `const loadServers = ...`) добавить:

```tsx
  const callLeaveGroupCall = () => {
    const w = window as unknown as Record<string, unknown>;
    (w.leaveGroupCall as (() => void) | undefined)?.();
  };

  const handleServerRemoved = (removedServerId: string) => {
    if (currentServer?.id !== removedServerId) return;

    if (
      groupCallService.isInGroupCallState &&
      channels.some((c) => c.id === groupCallService.currentRoomIdState)
    ) {
      callLeaveGroupCall();
    }

    const remaining = useServerStore.getState().servers;
    if (remaining.length > 0) {
      handleSelectServer(remaining[0]);
    } else {
      setCurrentServer(null);
      setChannels([]);
      setCurrentChannel(null);
      setMembers([]);
      setMessages([]);
    }
  };

  const handleChannelRemoved = (removedChannelId: string) => {
    if (groupCallService.isInGroupCallState && groupCallService.currentRoomIdState === removedChannelId) {
      callLeaveGroupCall();
    }

    if (currentChannel?.id !== removedChannelId) return;

    const remaining = useServerStore.getState().channels;
    const textChannel = remaining.find((c) => c.type === 'text');
    if (textChannel) {
      handleSelectChannel(textChannel);
    } else {
      setCurrentChannel(null);
      setMessages([]);
    }
  };
```

Эти два хелпера объявлены до `handleSelectServer`/`handleSelectChannel` в порядке чтения файла, но JS function-scoping (`const` + замыкание, вызываются только из эффектов/колбэков ниже, не во время рендера) допускает такой порядок — обе функции вызываются позже, когда `handleSelectServer`/`handleSelectChannel` уже определены в той же замыкающей области видимости компонента.

- [ ] **Step 2: Добавить WS-подписки на `server_update`/`channel_update`/`server_delete`/`channel_delete`**

После существующего эффекта на `user_updated` (после блока, заканчивающегося `}, []);` для `user_updated`) добавить:

```tsx
  useEffect(() => {
    const unsubServerUpdate = wsService.on('server_update', (payload) => {
      const p = payload as Server;
      useServerStore.getState().patchServer(p.id, { name: p.name, icon_url: p.icon_url });
    });
    const unsubChannelUpdate = wsService.on('channel_update', (payload) => {
      const p = payload as Channel;
      useServerStore.getState().patchChannel(p.id, { name: p.name });
    });
    const unsubServerDelete = wsService.on('server_delete', (payload) => {
      const { id } = payload as { id: string };
      useServerStore.getState().removeServer(id);
      handleServerRemoved(id);
    });
    const unsubChannelDelete = wsService.on('channel_delete', (payload) => {
      const { id } = payload as { id: string; server_id: string };
      useServerStore.getState().removeChannel(id);
      handleChannelRemoved(id);
    });
    return () => {
      unsubServerUpdate();
      unsubChannelUpdate();
      unsubServerDelete();
      unsubChannelDelete();
    };
  }, [currentServer, currentChannel, channels]);
```

(Зависимости `[currentServer, currentChannel, channels]` — тот же паттерн, что у существующего эффекта `voice_call_ring` в этом файле (`}, [currentServer, user]);`): переподписка при изменении состояния гарантирует, что замыкания `handleServerRemoved`/`handleChannelRemoved` внутри слушателей видят актуальные `currentServer`/`currentChannel`/`channels`, а не устаревшие значения из момента первого монтирования.)

- [ ] **Step 3: Передать новые пропсы в `ServerList` и `ChannelSidebar`**

Заменить рендер `<ServerList ... />`:

```tsx
        <ServerList
          servers={servers}
          currentServer={currentServer}
          user={user}
          onSelectServer={handleSelectServer}
          onCreateServer={() => setShowCreateServer(true)}
          onJoinServer={handleJoinServer}
          onServerDeleted={handleServerRemoved}
        />
```

Заменить рендер `<ChannelSidebar ... />`:

```tsx
        <ChannelSidebar
          server={currentServer}
          channels={channels}
          currentChannel={currentChannel}
          onSelectChannel={handleSelectChannel}
          user={user}
          onLogout={logout}
          onMobileBack={() => setMobilePanel('servers')}
          voiceParticipants={voiceParticipants}
          members={members}
          onChannelDeleted={handleChannelRemoved}
        />
```

- [ ] **Step 4: Типчек всего клиента**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок — это первый момент, когда весь цепочка пропсов (`ServerList`/`ChannelSidebar` из Task 12/13 + их использование здесь) типизируется целиком.

- [ ] **Step 5: Коммит**

```bash
git add client/src/pages/AppPage.tsx
git commit -m "feat(servers): wire edit/delete UI + WS sync (server_update/server_delete/channel_update/channel_delete)"
```

---

### Task 15: Сквозная проверка (backend тесты + два клиента: владелец и участник)

**Files:** нет изменений — только проверка.

- [ ] **Step 1: Финальный прогон backend-тестов**

Run: `cd server && go test ./... -v 2>&1 | tail -100`
Expected: все пакеты PASS, включая все новые тесты из Task 3/4/5.

Run: `cd server && go build ./... && go vet ./...`
Expected: успешно.

- [ ] **Step 2: Типчек клиента**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Поднять backend и клиент**

Запустить сервер (`cd server && go run cmd/api/main.go`, либо принятый в проекте способ через `Makefile`/`docker-compose.yml`) и клиент (`cd client && npm run dev:vite`), подключённые к одной БД.

- [ ] **Step 4: Проверка владельцем — сервер**

Залогиниться пользователем, создавшим сервер (owner). Открыть сервер, правым кликом по иконке сервера в `ServerList` — должно появиться контекстное меню «Редактировать»/«Удалить сервер». «Редактировать» → сменить название, загрузить иконку (проверить crop-модалку и отображение результата), удалить иконку — все три действия должны сразу отражаться в `ServerList`/шапке `ChannelSidebar`.

- [ ] **Step 5: Проверка владельцем — каналы**

Правым кликом по текстовому/голосовому каналу в `ChannelSidebar` — меню «Редактировать»/«Удалить канал». Переименовать канал — новое имя должно сразу появиться в списке. Убедиться, что пункт «Удалить канал» задизейблен (с тултипом), если в сервере остался ровно 1 канал; создать (через `curl`, см. Step 7) второй канал, чтобы проверить успешное удаление одного из двух.

- [ ] **Step 6: Проверка синхронизации между двумя клиентами**

Открыть один и тот же сервер в двух вкладках/окнах под одним владельцем. Переименовать сервер в одной вкладке → имя должно обновиться во второй вкладке без перезагрузки (`server_update`). Удалить не-последний канал в одной вкладке → он должен исчезнуть во второй (`channel_delete`); если во второй вкладке этот канал был открыт — она должна автоматически переключиться на первый текстовый канал. Удалить сам сервер → в обеих вкладках сервер должен пропасть из `ServerList`, а та вкладка, где он был текущим, — переключиться на другой сервер или показать пустое состояние «Select or create a server to get started».

- [ ] **Step 7: Проверка запретов — участник без прав владельца**

Вторым пользователем (не owner) присоединиться к серверу владельца. Убедиться, что при правом клике по серверу/каналам контекстное меню **не появляется** (проверка `owner_id === user.id` на клиенте). Через `curl` с валидным JWT этого пользователя (не владельца) попытаться:

```bash
curl -X PATCH http://localhost:8080/api/v1/servers/<SERVER_ID> \
  -H "Authorization: Bearer <MEMBER_JWT>" -H "Content-Type: application/json" \
  -d '{"name":"hacked"}'
```

Expected: `403 {"error":"access denied"}`.

```bash
curl -X DELETE http://localhost:8080/api/v1/servers/<SERVER_ID> \
  -H "Authorization: Bearer <MEMBER_JWT>"
```

Expected: `403 {"error":"access denied"}`.

Попытка удалить последний канал сервера от лица владельца:

```bash
curl -X DELETE http://localhost:8080/api/v1/servers/<SERVER_ID>/channels/<LAST_CHANNEL_ID> \
  -H "Authorization: Bearer <OWNER_JWT>"
```

Expected (если это единственный оставшийся канал): `400 {"error":"cannot delete the last channel of a server"}`.

- [ ] **Step 8: Проверка звонка при удалении**

Владельцу зайти в голосовой канал (запустить звонок), другому клиенту (та же учётная запись, вторая вкладка, или другой пользователь) — правым кликом удалить этот голосовой канал. У клиента, находившегося в звонке, должен произойти автоматический выход из звонка (`GroupCallUI` закрывается / состояние `isInGroupCallState` становится `false`) без зависаний или ошибок в консоли браузера.

Никакого коммита на этом шаге — задача чисто верификационная.
