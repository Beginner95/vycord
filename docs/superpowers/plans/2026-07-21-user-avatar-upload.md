# User Avatar Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload, crop, and remove their avatar from a new "Профиль" tab in Settings, with the image validated and stored on the API server and propagated live to all connected clients.

**Architecture:** Go API gains a `filestorage.Storage` interface (local-disk implementation for now) plus two new `UserHandler` endpoints that validate/store the image and broadcast a `user_updated` WS event. The React client gains a shared `Avatar` component (image-or-initials), a canvas-based `AvatarCropModal`, and a `ProfileSettings` tab; `Settings.tsx` is restructured into a Discord-style tab shell.

**Tech Stack:** Go 1.24 stdlib (`net/http`, `image`, `image/png`, `image/jpeg`), pgx, existing WS hub; React 19 + TypeScript, zustand, no new npm dependencies.

## Global Constraints

- Accepted avatar formats: PNG, JPG, JPEG only (both client- and server-side).
- Max avatar file size: 2 MB (both client- and server-side).
- No new npm dependencies — the crop UI is a hand-rolled `<canvas>` component.
- File storage is local disk behind a `Storage` interface (no S3 in this task).
- Avatar changes propagate live to other connected clients via a WS `user_updated` event — no page reload required.
- Exported/stored avatar image is always a plain square JPEG (512×512) — the circular look comes from CSS `border-radius`, never baked into the stored file.
- Deploy pipeline is not modified in this task — only a new `UPLOAD_DIR` env var is introduced (see Task 5).

---

## Task 1: `filestorage` package — Storage interface + local disk implementation

**Files:**
- Create: `server/pkg/filestorage/storage.go`
- Create: `server/pkg/filestorage/local.go`
- Create: `server/pkg/filestorage/local_test.go`

**Interfaces:**
- Produces: `filestorage.Storage` interface with `Save(ctx context.Context, key string, r io.Reader, contentType string) (url string, err error)` and `Delete(ctx context.Context, url string) error`; `filestorage.NewLocal(rootDir, urlPrefix string) (*Local, error)` constructor. `key` is always caller-controlled (never derived from untrusted input). `Delete` takes the exact `url` string previously returned by `Save`.

- [ ] **Step 1: Write `storage.go`**

```go
// Package filestorage abstracts where uploaded files (avatars today, other
// attachments later) are physically stored, so the backend can move from
// local disk to an object store without touching callers.
package filestorage

import (
	"context"
	"io"
)

// Storage saves and deletes files by an opaque URL. Save assigns the file a
// URL derived from key; Delete removes whatever Save previously returned —
// callers never need to know the underlying key format.
//
// key is always constructed by the caller from trusted, server-generated
// values (e.g. a user ID + random suffix) — implementations do not sanitize
// it against path traversal.
type Storage interface {
	// Save reads all of r and stores it under key, returning the URL clients
	// can use to fetch the file.
	Save(ctx context.Context, key string, r io.Reader, contentType string) (url string, err error)
	// Delete removes the file previously saved at url. Deleting a URL that
	// does not exist is not an error.
	Delete(ctx context.Context, url string) error
}
```

- [ ] **Step 2: Write `local.go`**

```go
package filestorage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Local stores files on the local filesystem under rootDir and serves them
// back under urlPrefix (see cmd/api's "GET /uploads/" static route).
type Local struct {
	rootDir   string
	urlPrefix string
}

// NewLocal returns a Local storage rooted at rootDir, creating the directory
// if it does not exist yet. Saved files are addressable at
// urlPrefix + "/" + key.
func NewLocal(rootDir, urlPrefix string) (*Local, error) {
	if err := os.MkdirAll(rootDir, 0o755); err != nil {
		return nil, fmt.Errorf("create upload dir: %w", err)
	}
	return &Local{
		rootDir:   rootDir,
		urlPrefix: strings.TrimSuffix(urlPrefix, "/"),
	}, nil
}

func (s *Local) Save(_ context.Context, key string, r io.Reader, _ string) (string, error) {
	path := filepath.Join(s.rootDir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("create dir for %s: %w", key, err)
	}

	f, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("create file %s: %w", key, err)
	}
	defer f.Close()

	if _, err := io.Copy(f, r); err != nil {
		return "", fmt.Errorf("write file %s: %w", key, err)
	}

	return s.urlPrefix + "/" + key, nil
}

func (s *Local) Delete(_ context.Context, url string) error {
	key := strings.TrimPrefix(url, s.urlPrefix+"/")
	if key == url {
		return fmt.Errorf("url %q does not belong to this storage", url)
	}

	path := filepath.Join(s.rootDir, filepath.FromSlash(key))
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete file %s: %w", key, err)
	}
	return nil
}
```

- [ ] **Step 3: Write `local_test.go`**

```go
package filestorage_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/pkg/filestorage"
)

func TestLocal_SaveThenDelete(t *testing.T) {
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	url, err := storage.Save(context.Background(), "avatars/u1/abc.jpg", strings.NewReader("fake-jpeg-bytes"), "image/jpeg")
	require.NoError(t, err)
	assert.Equal(t, "/uploads/avatars/u1/abc.jpg", url)

	data, err := os.ReadFile(filepath.Join(dir, "avatars", "u1", "abc.jpg"))
	require.NoError(t, err)
	assert.Equal(t, "fake-jpeg-bytes", string(data))

	err = storage.Delete(context.Background(), url)
	require.NoError(t, err)

	_, err = os.Stat(filepath.Join(dir, "avatars", "u1", "abc.jpg"))
	assert.True(t, os.IsNotExist(err))
}

func TestLocal_DeleteNonexistentKeyIsNotAnError(t *testing.T) {
	dir := t.TempDir()
	storage, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	err = storage.Delete(context.Background(), "/uploads/avatars/missing.jpg")
	assert.NoError(t, err)
}

func TestLocal_SaveCreatesRootDirIfMissing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "uploads")
	_, err := filestorage.NewLocal(dir, "/uploads")
	require.NoError(t, err)

	info, err := os.Stat(dir)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}
```

- [ ] **Step 4: Run the tests**

Run: `cd server && go test ./pkg/filestorage/... -v`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pkg/filestorage
git commit -m "VYC-42 Add filestorage package with local disk implementation"
```

---

## Task 2: Domain errors + `UserUseCase` interface for avatar operations

**Files:**
- Modify: `server/internal/domain/errors.go`
- Modify: `server/internal/domain/usecase.go`

**Interfaces:**
- Consumes: nothing new.
- Produces: `domain.ErrUnsupportedAvatarFormat`, `domain.ErrInvalidAvatarImage`, `domain.ErrInvalidAvatarDimensions` sentinel errors; `UserUseCase.UpdateAvatar(id uuid.UUID, data []byte) (*User, error)` and `UserUseCase.RemoveAvatar(id uuid.UUID) (*User, error)` — implemented in Task 3.

- [ ] **Step 1: Add sentinel errors**

In `server/internal/domain/errors.go`, add to the `var (...)` block (after `ErrMentionForbidden`):

```go
	// ErrUnsupportedAvatarFormat — загружаемый файл не PNG и не JPEG.
	ErrUnsupportedAvatarFormat = errors.New("unsupported avatar format")
	// ErrInvalidAvatarImage — файл не декодируется как валидное изображение.
	ErrInvalidAvatarImage = errors.New("invalid avatar image")
	// ErrInvalidAvatarDimensions — разрешение изображения вне допустимых границ.
	ErrInvalidAvatarDimensions = errors.New("invalid avatar dimensions")
```

- [ ] **Step 2: Extend `UserUseCase` interface**

In `server/internal/domain/usecase.go`, in the `UserUseCase` interface, add after `UpdateLastVisited(id uuid.UUID, serverID, channelID *uuid.UUID) error`:

```go
	UpdateAvatar(id uuid.UUID, data []byte) (*User, error)
	RemoveAvatar(id uuid.UUID) (*User, error)
```

- [ ] **Step 3: Verify it builds (interface has no implementers yet, expect a compile error naming the gap)**

Run: `cd server && go build ./... 2>&1 | head -20`
Expected: build fails with `*userUseCase does not implement domain.UserUseCase (missing method UpdateAvatar)` — confirms the interface change is wired; Task 3 fixes it.

- [ ] **Step 4: Commit**

```bash
git add server/internal/domain/errors.go server/internal/domain/usecase.go
git commit -m "VYC-42 Add avatar domain errors and UserUseCase interface methods"
```

---

## Task 3: `userUseCase.UpdateAvatar` / `RemoveAvatar` implementation + tests

**Files:**
- Modify: `server/internal/usecase/user.go`
- Create: `server/internal/usecase/user_test.go`

**Interfaces:**
- Consumes: `filestorage.Storage` (Task 1), `domain.UserRepository.GetByID`/`Update` (existing), `domain.ErrUnsupportedAvatarFormat`/`ErrInvalidAvatarImage`/`ErrInvalidAvatarDimensions` (Task 2).
- Produces: `usecase.NewUserUseCase(userRepo domain.UserRepository, storage filestorage.Storage) domain.UserUseCase` — **signature changed**, now takes a second argument. `userUseCase.UpdateAvatar`/`RemoveAvatar` per the interface in Task 2.

- [ ] **Step 1: Replace the full contents of `server/internal/usecase/user.go`**

```go
package usecase

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)

const (
	minAvatarDimension = 32
	maxAvatarDimension = 4096
)

type userUseCase struct {
	userRepo domain.UserRepository
	storage  filestorage.Storage
}

func NewUserUseCase(userRepo domain.UserRepository, storage filestorage.Storage) domain.UserUseCase {
	return &userUseCase{userRepo: userRepo, storage: storage}
}

func (uc *userUseCase) GetByID(id uuid.UUID) (*domain.User, error) {
	user, err := uc.userRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	// Clear password hash
	user.Password = ""
	return user, nil
}

func (uc *userUseCase) Search(query string, limit int) ([]*domain.User, error) {
	users, err := uc.userRepo.Search(query, limit, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to search users: %w", err)
	}

	// Clear password hashes
	for _, user := range users {
		user.Password = ""
	}

	return users, nil
}

func (uc *userUseCase) UpdateStatus(id uuid.UUID, status domain.UserStatus) error {
	updates := map[string]interface{}{
		"status": status,
	}

	if err := uc.userRepo.Update(id, updates); err != nil {
		return fmt.Errorf("failed to update user status: %w", err)
	}

	return nil
}

func (uc *userUseCase) GetOnlineUserIDs() []uuid.UUID {
	// This is a stub - actual implementation gets online IDs from Hub
	return nil
}

func (uc *userUseCase) UpdateLastVisited(id uuid.UUID, serverID, channelID *uuid.UUID) error {
	if err := uc.userRepo.UpdateLastVisited(id, serverID, channelID); err != nil {
		return fmt.Errorf("failed to update last visited: %w", err)
	}
	return nil
}

// UpdateAvatar validates data as a PNG or JPEG image of sane dimensions,
// stores it, points the user's avatar_url at the new file, and deletes the
// previous avatar file (if any). Deletion failures are not fatal — an
// orphaned old file is not worse than a hard failure of the whole request.
func (uc *userUseCase) UpdateAvatar(id uuid.UUID, data []byte) (*domain.User, error) {
	contentType := http.DetectContentType(data)
	var ext string
	switch contentType {
	case "image/png":
		ext = "png"
	case "image/jpeg":
		ext = "jpg"
	default:
		return nil, domain.ErrUnsupportedAvatarFormat
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", domain.ErrInvalidAvatarImage, err)
	}
	if cfg.Width < minAvatarDimension || cfg.Height < minAvatarDimension ||
		cfg.Width > maxAvatarDimension || cfg.Height > maxAvatarDimension {
		return nil, domain.ErrInvalidAvatarDimensions
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

// RemoveAvatar clears the user's avatar_url and deletes the stored file. A
// no-op (not an error) if the user has no avatar set.
func (uc *userUseCase) RemoveAvatar(id uuid.UUID) (*domain.User, error) {
	user, err := uc.userRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}

	if user.AvatarURL == nil {
		user.Password = ""
		return user, nil
	}

	oldAvatarURL := *user.AvatarURL
	if err := uc.userRepo.Update(id, map[string]interface{}{"avatar_url": nil}); err != nil {
		return nil, fmt.Errorf("clear avatar url: %w", err)
	}
	_ = uc.storage.Delete(context.Background(), oldAvatarURL)

	user.AvatarURL = nil
	user.Password = ""
	return user, nil
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
```

- [ ] **Step 2: Run build to confirm the interface is satisfied**

Run: `cd server && go build ./...`
Expected: succeeds with no output.

- [ ] **Step 3: Write `server/internal/usecase/user_test.go`**

```go
package usecase_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type MockStorage struct{ mock.Mock }

func (m *MockStorage) Save(ctx context.Context, key string, r io.Reader, contentType string) (string, error) {
	args := m.Called(ctx, key, r, contentType)
	return args.String(0), args.Error(1)
}

func (m *MockStorage) Delete(ctx context.Context, url string) error {
	args := m.Called(ctx, url)
	return args.Error(0)
}

func fakePNGBytes(width, height int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 100, B: 50, A: 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func fakeJPEGBytes(width, height int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}

func TestUpdateAvatar_SavesValidPNGAndUpdatesUser(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	userID := uuid.New()
	existing := &domain.User{ID: userID, Username: "alice"}
	userRepo.On("GetByID", userID).Return(existing, nil)
	storage.On("Save", mock.Anything, mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, "avatars/"+userID.String()+"/") && strings.HasSuffix(key, ".png")
	}), mock.Anything, "image/png").Return("/uploads/avatars/x/y.png", nil)
	userRepo.On("Update", userID, map[string]interface{}{"avatar_url": "/uploads/avatars/x/y.png"}).Return(nil)

	user, err := uc.UpdateAvatar(userID, fakePNGBytes(64, 64))

	require.NoError(t, err)
	require.NotNil(t, user.AvatarURL)
	assert.Equal(t, "/uploads/avatars/x/y.png", *user.AvatarURL)
	userRepo.AssertExpectations(t)
	storage.AssertExpectations(t)
}

func TestUpdateAvatar_SavesValidJPEG(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	userID := uuid.New()
	existing := &domain.User{ID: userID, Username: "alice"}
	userRepo.On("GetByID", userID).Return(existing, nil)
	storage.On("Save", mock.Anything, mock.Anything, mock.Anything, "image/jpeg").Return("/uploads/avatars/x/y.jpg", nil)
	userRepo.On("Update", userID, map[string]interface{}{"avatar_url": "/uploads/avatars/x/y.jpg"}).Return(nil)

	user, err := uc.UpdateAvatar(userID, fakeJPEGBytes(64, 64))

	require.NoError(t, err)
	assert.Equal(t, "/uploads/avatars/x/y.jpg", *user.AvatarURL)
}

func TestUpdateAvatar_DeletesOldAvatarAfterReplacing(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	userID := uuid.New()
	oldURL := "/uploads/avatars/old.png"
	existing := &domain.User{ID: userID, Username: "alice", AvatarURL: &oldURL}
	userRepo.On("GetByID", userID).Return(existing, nil)
	storage.On("Save", mock.Anything, mock.Anything, mock.Anything, "image/png").Return("/uploads/avatars/new.png", nil)
	userRepo.On("Update", userID, map[string]interface{}{"avatar_url": "/uploads/avatars/new.png"}).Return(nil)
	storage.On("Delete", mock.Anything, oldURL).Return(nil)

	_, err := uc.UpdateAvatar(userID, fakePNGBytes(64, 64))

	require.NoError(t, err)
	storage.AssertExpectations(t)
}

func TestUpdateAvatar_RejectsUnsupportedFormat(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	_, err := uc.UpdateAvatar(uuid.New(), []byte("not an image, just plain text bytes"))

	assert.ErrorIs(t, err, domain.ErrUnsupportedAvatarFormat)
	userRepo.AssertNotCalled(t, "GetByID", mock.Anything)
	storage.AssertNotCalled(t, "Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestUpdateAvatar_RejectsCorruptImageData(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	// Valid PNG magic-byte signature, truncated/corrupt body — passes
	// content-type sniffing, fails image.DecodeConfig.
	data := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02}

	_, err := uc.UpdateAvatar(uuid.New(), data)

	assert.ErrorIs(t, err, domain.ErrInvalidAvatarImage)
}

func TestUpdateAvatar_RejectsImageBelowMinimumDimensions(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	_, err := uc.UpdateAvatar(uuid.New(), fakePNGBytes(16, 16))

	assert.ErrorIs(t, err, domain.ErrInvalidAvatarDimensions)
}

func TestUpdateAvatar_RejectsImageAboveMaximumDimensions(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	// Asymmetric dimensions keep the fake PNG small/fast to encode while
	// still exceeding maxAvatarDimension on one axis.
	_, err := uc.UpdateAvatar(uuid.New(), fakePNGBytes(4097, 10))

	assert.ErrorIs(t, err, domain.ErrInvalidAvatarDimensions)
}

func TestRemoveAvatar_ClearsURLAndDeletesFile(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	userID := uuid.New()
	oldURL := "/uploads/avatars/old.png"
	existing := &domain.User{ID: userID, Username: "alice", AvatarURL: &oldURL}
	userRepo.On("GetByID", userID).Return(existing, nil)
	userRepo.On("Update", userID, map[string]interface{}{"avatar_url": nil}).Return(nil)
	storage.On("Delete", mock.Anything, oldURL).Return(nil)

	user, err := uc.RemoveAvatar(userID)

	require.NoError(t, err)
	assert.Nil(t, user.AvatarURL)
	userRepo.AssertExpectations(t)
	storage.AssertExpectations(t)
}

func TestRemoveAvatar_NoOpWhenNoAvatarSet(t *testing.T) {
	userRepo := new(MockUserRepository)
	storage := new(MockStorage)
	uc := usecase.NewUserUseCase(userRepo, storage)

	userID := uuid.New()
	existing := &domain.User{ID: userID, Username: "alice"}
	userRepo.On("GetByID", userID).Return(existing, nil)

	user, err := uc.RemoveAvatar(userID)

	require.NoError(t, err)
	assert.Nil(t, user.AvatarURL)
	userRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
	storage.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything)
}
```

`MockUserRepository` is already defined in `server/internal/usecase/auth_test.go` (same `usecase_test` package) — do not redefine it here.

- [ ] **Step 4: Run the tests**

Run: `cd server && go test ./internal/usecase/... -run 'TestUpdateAvatar|TestRemoveAvatar' -v`
Expected: all 9 tests PASS.

- [ ] **Step 5: Run the full usecase package test suite to confirm nothing else broke**

Run: `cd server && go test ./internal/usecase/...`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add server/internal/usecase/user.go server/internal/usecase/user_test.go
git commit -m "VYC-42 Implement userUseCase.UpdateAvatar/RemoveAvatar with validation"
```

---

## Task 4: `Hub.BroadcastUserUpdate`

**Files:**
- Modify: `server/internal/delivery/ws/hub.go`
- Modify: `server/internal/delivery/ws/hub_test.go`

**Interfaces:**
- Consumes: existing `Hub.BroadcastMessage`, `Hub.RegisterClient`, `Hub.IsOnline`.
- Produces: `Hub.BroadcastUserUpdate(userID uuid.UUID, avatarURL *string)` — sends `{"type": "user_updated", "payload": {"id": "<uuid>", "avatar_url": "<url or null>"}}` to every connected client.

- [ ] **Step 1: Add the method to `hub.go`**

Insert after `BroadcastVoiceParticipants` (after its closing `}`, before `func (h *Hub) notifyAllOnlineUsers`):

```go

// BroadcastUserUpdate notifies all connected clients that userID's profile
// changed (currently only the avatar). avatarURL is nil when the avatar was
// removed, which marshals to JSON null.
func (h *Hub) BroadcastUserUpdate(userID uuid.UUID, avatarURL *string) {
	h.BroadcastMessage(&Message{
		Type: "user_updated",
		Payload: mustMarshal(map[string]interface{}{
			"id":         userID.String(),
			"avatar_url": avatarURL,
		}),
	})
}
```

- [ ] **Step 2: Add a test to `hub_test.go`**

Insert after `TestUnregister_BroadcastsVoiceParticipantsToOtherClients` (after its closing `}`):

```go

func TestBroadcastUserUpdate_SendsToAllClients(t *testing.T) {
	h := newTestHub()
	go h.Run()

	userA := uuid.New()
	userB := uuid.New()
	clientA := &Client{UserID: userA, Send: make(chan []byte, 8)}
	clientB := &Client{UserID: userB, Send: make(chan []byte, 8)}
	h.RegisterClient(clientA)
	h.RegisterClient(clientB)
	assert.Eventually(t, func() bool { return h.IsOnline(userA) && h.IsOnline(userB) },
		time.Second, 10*time.Millisecond)

	url := "/uploads/avatars/x.jpg"
	h.BroadcastUserUpdate(userA, &url)

	deadline := time.After(time.Second)
	for {
		select {
		case msg := <-clientB.Send:
			if strings.Contains(string(msg), `"user_updated"`) && strings.Contains(string(msg), url) {
				return
			}
		case <-deadline:
			t.Fatal("client B did not receive a user_updated broadcast")
		}
	}
}

func TestBroadcastUserUpdate_NilAvatarMarshalsToNull(t *testing.T) {
	h := newTestHub()
	go h.Run()

	userA := uuid.New()
	clientA := &Client{UserID: userA, Send: make(chan []byte, 8)}
	h.RegisterClient(clientA)
	assert.Eventually(t, func() bool { return h.IsOnline(userA) }, time.Second, 10*time.Millisecond)

	h.BroadcastUserUpdate(userA, nil)

	deadline := time.After(time.Second)
	for {
		select {
		case msg := <-clientA.Send:
			if strings.Contains(string(msg), `"user_updated"`) {
				assert.Contains(t, string(msg), `"avatar_url":null`)
				return
			}
		case <-deadline:
			t.Fatal("client did not receive a user_updated broadcast")
		}
	}
}
```

- [ ] **Step 3: Run the tests**

Run: `cd server && go test ./internal/delivery/ws/... -run TestBroadcastUserUpdate -v`
Expected: both tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/delivery/ws/hub.go server/internal/delivery/ws/hub_test.go
git commit -m "VYC-42 Add Hub.BroadcastUserUpdate for live avatar propagation"
```

---

## Task 5: `UPLOAD_DIR` config + env docs + gitignore

**Files:**
- Modify: `server/internal/config/config.go`
- Modify: `.env.example`
- Modify: `.env.prod.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Config.UploadDir string`, populated from `UPLOAD_DIR` env var, default `./uploads`.

- [ ] **Step 1: Add the field to the `Config` struct**

In `server/internal/config/config.go`, in the `Config` struct, add after `TURNTTL       time.Duration`:

```go
	UploadDir     string
```

- [ ] **Step 2: Populate it in `New()`**

In the `cfg := &Config{...}` literal, add after `TURNTTL:       parseDuration(getEnv("TURN_CREDENTIAL_TTL", "12h")),`:

```go
		UploadDir:     getEnv("UPLOAD_DIR", "./uploads"),
```

- [ ] **Step 3: Document the env var**

In `.env.example`, add a new section at the end:

```
# File storage (avatars)
UPLOAD_DIR=./uploads
```

In `.env.prod.example`, add after the `CORS` section:

```

# File storage (avatars) — must point at a persistent volume that survives
# API redeploys, not a path inside a container/build artifact.
UPLOAD_DIR=/var/lib/vycord/uploads
```

- [ ] **Step 4: Ignore local upload files**

In `.gitignore`, add a new section after `# Certificates`:

```

# Uploaded user files (avatars, local disk storage)
uploads/
```

- [ ] **Step 5: Verify build**

Run: `cd server && go build ./...`
Expected: succeeds with no output.

- [ ] **Step 6: Commit**

```bash
git add server/internal/config/config.go .env.example .env.prod.example .gitignore
git commit -m "VYC-42 Add UPLOAD_DIR config for avatar file storage"
```

---

## Task 6: `UserHandler` avatar endpoints

**Files:**
- Modify: `server/internal/delivery/http/handler/user.go`
- Modify: `server/internal/delivery/http/handler/websocket_test.go`
- Modify: `server/internal/delivery/http/handler/user_test.go`

**Interfaces:**
- Consumes: `domain.UserUseCase.UpdateAvatar`/`RemoveAvatar` (Task 3), `ws.Hub.BroadcastUserUpdate` (Task 4).
- Produces: `NewUserHandler(userUseCase domain.UserUseCase, hub *ws.Hub, log *slog.Logger) *UserHandler` — **signature changed**, now takes `hub` as second argument. `UserHandler.UploadAvatar`, `UserHandler.RemoveAvatar` (both `http.HandlerFunc`-compatible methods).

- [ ] **Step 1: Replace the full contents of `server/internal/delivery/http/handler/user.go`**

```go
package handler

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

const (
	// maxAvatarRequestBytes caps the raw multipart request body — a bit
	// above maxAvatarFileBytes to leave room for multipart boundaries/headers.
	maxAvatarRequestBytes = 3 << 20
	// maxAvatarFileBytes is the spec limit on the actual avatar file content.
	maxAvatarFileBytes = 2 << 20
)

type UserHandler struct {
	userUseCase domain.UserUseCase
	hub         *ws.Hub
	log         *slog.Logger
}

func NewUserHandler(userUseCase domain.UserUseCase, hub *ws.Hub, log *slog.Logger) *UserHandler {
	return &UserHandler{
		userUseCase: userUseCase,
		hub:         hub,
		log:         log,
	}
}

func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	user, err := h.userUseCase.GetByID(userID)
	if err != nil {
		h.sendError(w, http.StatusNotFound, "user not found")
		return
	}

	h.sendJSON(w, http.StatusOK, user)
}

func (h *UserHandler) GetUserByID(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	userID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	user, err := h.userUseCase.GetByID(userID)
	if err != nil {
		h.sendError(w, http.StatusNotFound, "user not found")
		return
	}

	h.sendJSON(w, http.StatusOK, user)
}

func (h *UserHandler) UpdateLastVisited(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	var req struct {
		ServerID  *string `json:"server_id"`
		ChannelID *string `json:"channel_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var serverID, channelID *uuid.UUID
	if req.ServerID != nil {
		id, err := uuid.Parse(*req.ServerID)
		if err != nil {
			h.sendError(w, http.StatusBadRequest, "invalid server_id")
			return
		}
		serverID = &id
	}
	if req.ChannelID != nil {
		id, err := uuid.Parse(*req.ChannelID)
		if err != nil {
			h.sendError(w, http.StatusBadRequest, "invalid channel_id")
			return
		}
		channelID = &id
	}

	if err := h.userUseCase.UpdateLastVisited(userID, serverID, channelID); err != nil {
		h.log.Error("failed to update last visited", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, "failed to update last visited")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *UserHandler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		h.sendError(w, http.StatusBadRequest, "query parameter 'q' is required")
		return
	}

	limit := 20
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if _, err := fmt.Sscanf(limitStr, "%d", &limit); err != nil {
			limit = 20
		}
	}

	users, err := h.userUseCase.Search(query, limit)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, "failed to search users")
		return
	}

	h.sendJSON(w, http.StatusOK, users)
}

// UploadAvatar accepts a multipart/form-data request with a single "avatar"
// field (PNG or JPEG, ≤2MB), stores it, updates the user's avatar_url, and
// broadcasts the change to all connected clients over WebSocket.
func (h *UserHandler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarRequestBytes)
	if err := r.ParseMultipartForm(maxAvatarRequestBytes); err != nil {
		h.sendError(w, http.StatusRequestEntityTooLarge, "avatar file is too large")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, _, err := r.FormFile("avatar")
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "avatar file is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxAvatarFileBytes+1))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "failed to read avatar file")
		return
	}
	if len(data) > maxAvatarFileBytes {
		h.sendError(w, http.StatusRequestEntityTooLarge, "avatar file is too large")
		return
	}

	user, err := h.userUseCase.UpdateAvatar(userID, data)
	if err != nil {
		h.writeUserError(w, r, err)
		return
	}

	h.hub.BroadcastUserUpdate(userID, user.AvatarURL)
	h.sendJSON(w, http.StatusOK, user)
}

// RemoveAvatar clears the caller's avatar and broadcasts the change.
func (h *UserHandler) RemoveAvatar(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	user, err := h.userUseCase.RemoveAvatar(userID)
	if err != nil {
		h.writeUserError(w, r, err)
		return
	}

	h.hub.BroadcastUserUpdate(userID, user.AvatarURL)
	h.sendJSON(w, http.StatusOK, user)
}

func (h *UserHandler) writeUserError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrUnsupportedAvatarFormat):
		h.sendError(w, http.StatusBadRequest, "unsupported format: only PNG and JPEG are allowed")
	case errors.Is(err, domain.ErrInvalidAvatarImage):
		h.sendError(w, http.StatusBadRequest, "invalid image file")
	case errors.Is(err, domain.ErrInvalidAvatarDimensions):
		h.sendError(w, http.StatusBadRequest, "image dimensions are out of allowed range")
	default:
		h.log.Error("user avatar request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, "failed to update avatar")
	}
}

func (h *UserHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *UserHandler) sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
```

- [ ] **Step 2: Add `UpdateAvatar`/`RemoveAvatar` to `mockUserUseCase` in `websocket_test.go`**

In `server/internal/delivery/http/handler/websocket_test.go`, insert after the existing `UpdateLastVisited` mock method (after its closing `}`, before `type mockCallUseCase struct{ mock.Mock }`):

```go

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
```

- [ ] **Step 3: Fix the existing test's constructor call and add avatar endpoint tests — replace the full contents of `user_test.go`**

```go
package handler

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

func TestUserHandler_UpdateLastVisited_LogsRequestIDOnError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	mockUC.On("UpdateLastVisited", userID, (*uuid.UUID)(nil), (*uuid.UUID)(nil)).Return(errors.New("db down"))

	hub := ws.NewHub(log)
	h := NewUserHandler(mockUC, hub, log)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/me/last-visited", strings.NewReader(`{}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	chain := middleware.RequestID(http.HandlerFunc(h.UpdateLastVisited))
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	headerID := rec.Header().Get(middleware.RequestIDHeader)
	if headerID == "" {
		t.Fatal("expected X-Request-Id header to be set")
	}
	if !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected error log to contain request_id=%s, got: %s", headerID, buf.String())
	}
}

func multipartAvatarBody(t *testing.T, filename string, content []byte) (*bytes.Buffer, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	part, err := w.CreateFormFile("avatar", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return buf, w.FormDataContentType()
}

func TestUserHandler_UploadAvatar_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	go hub.Run()

	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	avatarURL := "/uploads/avatars/new.png"
	updated := &domain.User{ID: userID, Username: "alice", AvatarURL: &avatarURL}
	mockUC.On("UpdateAvatar", userID, mock.Anything).Return(updated, nil)

	h := NewUserHandler(mockUC, hub, log)

	body, contentType := multipartAvatarBody(t, "avatar.png", []byte("fake-png-bytes"))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/avatar", body)
	req.Header.Set("Content-Type", contentType)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.UploadAvatar(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	mockUC.AssertExpectations(t)
}

func TestUserHandler_UploadAvatar_RejectsOversizedFile(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	// 2.5MB: over the 2MB file limit, but under the 3MB wire cap — exercises
	// the application-level size check, not the http.MaxBytesReader backstop.
	oversized := make([]byte, int(2.5*1024*1024))
	body, contentType := multipartAvatarBody(t, "avatar.png", oversized)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/avatar", body)
	req.Header.Set("Content-Type", contentType)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	h.UploadAvatar(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d: %s", rec.Code, rec.Body.String())
	}
	mockUC.AssertNotCalled(t, "UpdateAvatar", mock.Anything, mock.Anything)
}

func TestUserHandler_UploadAvatar_RejectsMissingFile(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	_ = w.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/avatar", buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	h.UploadAvatar(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUserHandler_UploadAvatar_TranslatesUnsupportedFormatError(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	mockUC.On("UpdateAvatar", userID, mock.Anything).Return(nil, domain.ErrUnsupportedAvatarFormat)

	h := NewUserHandler(mockUC, hub, log)

	body, contentType := multipartAvatarBody(t, "avatar.png", []byte("not really a png"))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/users/me/avatar", body)
	req.Header.Set("Content-Type", contentType)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.UploadAvatar(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestUserHandler_RemoveAvatar_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	go hub.Run()

	mockUC := new(mockUserUseCase)
	userID := uuid.New()
	updated := &domain.User{ID: userID, Username: "alice"}
	mockUC.On("RemoveAvatar", userID).Return(updated, nil)

	h := NewUserHandler(mockUC, hub, log)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/users/me/avatar", nil)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.RemoveAvatar(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	mockUC.AssertExpectations(t)
}
```

- [ ] **Step 4: Run the handler tests**

Run: `cd server && go test ./internal/delivery/http/handler/... -v`
Expected: all tests PASS (including the pre-existing `websocket_test.go` and `TestUserHandler_UpdateLastVisited_LogsRequestIDOnError`).

- [ ] **Step 5: Commit**

```bash
git add server/internal/delivery/http/handler/user.go server/internal/delivery/http/handler/user_test.go server/internal/delivery/http/handler/websocket_test.go
git commit -m "VYC-42 Add UploadAvatar/RemoveAvatar endpoints to UserHandler"
```

---

## Task 7: Wire everything into `main.go`

**Files:**
- Modify: `server/cmd/api/main.go`

**Interfaces:**
- Consumes: `filestorage.NewLocal` (Task 1), `usecase.NewUserUseCase(userRepo, storage)` (Task 3), `handler.NewUserHandler(userUseCase, hub, log)` (Task 6), `cfg.UploadDir` (Task 5).

- [ ] **Step 1: Add the import**

In `server/cmd/api/main.go`, add to the import block (alphabetically, after `"github.com/vycord/server/internal/repository/postgres"`):

```go
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/filestorage"
	"github.com/vycord/server/pkg/logger"
```

(This replaces the existing `"github.com/vycord/server/internal/usecase"` and `"github.com/vycord/server/pkg/logger"` lines with the same two plus the new `filestorage` import inserted between them — end state is those three lines together in that order.)

- [ ] **Step 2: Initialize avatar storage before the usecases**

Replace:

```go
	// Initialize repositories
	userRepo := postgres.NewUserRepository(db)
	serverRepo := postgres.NewServerRepository(db)
	channelRepo := postgres.NewChannelRepository(db)
	messageRepo := postgres.NewMessageRepository(db)
	callRepo := postgres.NewCallRepository(db)

	// Initialize usecases
	authUseCase := usecase.NewAuthUseCase(userRepo, cfg.JWTSecret, cfg.JWTExpiration)
	userUseCase := usecase.NewUserUseCase(userRepo)
```

With:

```go
	// Initialize repositories
	userRepo := postgres.NewUserRepository(db)
	serverRepo := postgres.NewServerRepository(db)
	channelRepo := postgres.NewChannelRepository(db)
	messageRepo := postgres.NewMessageRepository(db)
	callRepo := postgres.NewCallRepository(db)

	// Avatar/file storage — local disk today; behind an interface so a
	// future S3-backed implementation can swap in without touching callers.
	avatarStorage, err := filestorage.NewLocal(cfg.UploadDir, "/uploads")
	if err != nil {
		log.Error("failed to initialize avatar storage", "error", err)
		os.Exit(1)
	}

	// Initialize usecases
	authUseCase := usecase.NewAuthUseCase(userRepo, cfg.JWTSecret, cfg.JWTExpiration)
	userUseCase := usecase.NewUserUseCase(userRepo, avatarStorage)
```

- [ ] **Step 3: Pass `hub` into `NewUserHandler`**

Replace:

```go
	userHandler := handler.NewUserHandler(userUseCase, log)
```

With:

```go
	userHandler := handler.NewUserHandler(userUseCase, hub, log)
```

- [ ] **Step 4: Add the avatar routes**

Replace:

```go
	router.HandleFunc("GET /api/v1/users", authMid.RequireAuth(userHandler.SearchUsers))
	router.HandleFunc("GET /api/v1/users/{id}", authMid.RequireAuth(userHandler.GetUserByID))
```

With:

```go
	router.HandleFunc("GET /api/v1/users", authMid.RequireAuth(userHandler.SearchUsers))
	router.HandleFunc("GET /api/v1/users/{id}", authMid.RequireAuth(userHandler.GetUserByID))
	router.HandleFunc("POST /api/v1/users/me/avatar", authMid.RequireAuth(userHandler.UploadAvatar))
	router.HandleFunc("DELETE /api/v1/users/me/avatar", authMid.RequireAuth(userHandler.RemoveAvatar))
```

- [ ] **Step 5: Add the static file route for uploaded avatars**

Replace:

```go
	// WebSocket route
	router.HandleFunc("GET /ws", wsHandler.HandleWebSocket)
```

With:

```go
	// Static file serving for uploaded avatars (local disk storage)
	router.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(cfg.UploadDir))))

	// WebSocket route
	router.HandleFunc("GET /ws", wsHandler.HandleWebSocket)
```

- [ ] **Step 6: Build**

Run: `cd server && go build ./...`
Expected: succeeds with no output.

- [ ] **Step 7: Run the full backend test suite**

Run: `cd server && go test ./...`
Expected: `ok` for every package, no failures.

- [ ] **Step 8: Commit**

```bash
git add server/cmd/api/main.go
git commit -m "VYC-42 Wire avatar storage and endpoints into main.go"
```

---

## Task 8: Shared `Avatar` component

**Files:**
- Create: `client/src/components/Avatar.tsx`
- Modify: `client/src/components/ChannelSidebar.css`
- Modify: `client/src/components/UserList.css`
- Modify: `client/src/components/ChatArea.css`

**Interfaces:**
- Produces: `Avatar({ url, username, className }: { url?: string; username: string; className: string })` — a React component. Renders `<img>` when `url` is set and hasn't failed to load, falling back to a div with the uppercased first letter of `username` (both using the exact `className` passed in, so existing avatar CSS classes apply unchanged).

- [ ] **Step 1: Create `Avatar.tsx`**

```tsx
import { useEffect, useState } from 'react';

interface AvatarProps {
  url?: string;
  username: string;
  className: string;
}

export function Avatar({ url, username, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return <img className={className} src={url} alt={username} onError={() => setFailed(true)} />;
  }

  return <div className={className}>{username.charAt(0).toUpperCase() || '?'}</div>;
}
```

- [ ] **Step 2: Make the `<img>` fill the existing avatar circles — add `object-fit: cover;` to the base rules**

In `client/src/components/ChannelSidebar.css`, in the `.user-avatar.small { ... }` rule, add `object-fit: cover;` as the last declaration before the closing `}`. Do the same in the `.voice-participant-avatar { ... }` rule.

In `client/src/components/UserList.css`, in the `.user-avatar.list { ... }` rule, add `object-fit: cover;` as the last declaration before the closing `}`.

In `client/src/components/ChatArea.css`, in the `.message-avatar { ... }` rule, add `object-fit: cover;` as the last declaration before the closing `}`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (the component isn't used yet, so this just checks it's syntactically/type-valid on its own).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Avatar.tsx client/src/components/ChannelSidebar.css client/src/components/UserList.css client/src/components/ChatArea.css
git commit -m "VYC-42 Add shared Avatar component (image-or-initials)"
```

---

## Task 9: API client, authStore, serverStore — avatar data layer

**Files:**
- Modify: `client/src/types/index.ts`
- Modify: `client/src/services/api.ts`
- Modify: `client/src/stores/authStore.ts`
- Modify: `client/src/stores/serverStore.ts`

**Interfaces:**
- Produces: `apiService.uploadAvatar(blob: Blob): Promise<User>`, `apiService.removeAvatar(): Promise<User>`; `AuthState.updateUser(patch: Partial<User>): void`; `ServerState.patchMemberAvatar(userId: string, avatarUrl: string | null): void`.

- [ ] **Step 1: Add `updateUser` to the `AuthState` type**

In `client/src/types/index.ts`, replace:

```ts
export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}
```

With:

```ts
export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (patch: Partial<User>) => void;
}
```

- [ ] **Step 2: Add `patchMemberAvatar` to `ServerState`**

In `client/src/stores/serverStore.ts`, replace the whole file with:

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
}));
```

- [ ] **Step 3: Add `updateUser` to `authStore.ts`**

In `client/src/stores/authStore.ts`, replace:

```ts
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null, isAuthenticated: false });
  },
}));
```

With:

```ts
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null, isAuthenticated: false });
  },

  updateUser: (patch: Partial<User>) => {
    set((state) => {
      if (!state.user) return state;
      const user = { ...state.user, ...patch };
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return { user };
    });
  },
}));
```

- [ ] **Step 4: Add avatar methods to `api.ts`**

In `client/src/services/api.ts`, add a new private method after `request<T>` (after its closing `}`, before `// Auth`):

```ts

  private async requestForm<T>(endpoint: string, options: RequestInit): Promise<T> {
    const token = this.getToken();
    const headers: HeadersInit = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (response.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }
```

Then add avatar endpoint methods after `getUserById` (after its closing `}`, before `// Servers`):

```ts

  async uploadAvatar(blob: Blob) {
    const formData = new FormData();
    formData.append('avatar', blob, 'avatar.jpg');
    return this.requestForm<User>('/api/v1/users/me/avatar', {
      method: 'POST',
      body: formData,
    });
  }

  async removeAvatar() {
    return this.requestForm<User>('/api/v1/users/me/avatar', {
      method: 'DELETE',
    });
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/types/index.ts client/src/services/api.ts client/src/stores/authStore.ts client/src/stores/serverStore.ts
git commit -m "VYC-42 Add avatar upload/remove API client methods and store actions"
```

---

## Task 10: `AppPage` live `user_updated` propagation

**Files:**
- Modify: `client/src/pages/AppPage.tsx`

**Interfaces:**
- Consumes: `wsService.on('user_updated', ...)` payload `{ id: string; avatar_url: string | null }` (Task 4/6 backend), `useAuthStore.getState().updateUser` and `useServerStore.getState().patchMemberAvatar` (Task 9).

- [ ] **Step 1: Add the WS listener**

In `client/src/pages/AppPage.tsx`, insert a new `useEffect` after the `voice_state`/`voice_participants` effect (after its closing `}, []);` around line 179, before `const loadServerMembers = ...`):

```tsx

  useEffect(() => {
    const unsubscribe = wsService.on('user_updated', (payload) => {
      const p = payload as { id: string; avatar_url: string | null };
      if (p.id === useAuthStore.getState().user?.id) {
        useAuthStore.getState().updateUser({ avatar_url: p.avatar_url ?? undefined });
      }
      useServerStore.getState().patchMemberAvatar(p.id, p.avatar_url);
    });
    return () => unsubscribe();
  }, []);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (`useAuthStore` and `useServerStore` are already imported at the top of the file).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/AppPage.tsx
git commit -m "VYC-42 Propagate live avatar updates from user_updated WS event"
```

---

## Task 11: `ChannelSidebar` — real avatars

**Files:**
- Modify: `client/src/components/ChannelSidebar.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 8), `MemberWithUser.avatar_url` (already in `types/index.ts`).

- [ ] **Step 1: Import `Avatar`**

In `client/src/components/ChannelSidebar.tsx`, replace:

```tsx
import { useState, useEffect, useMemo } from 'react';
import type { Server, Channel, User, MemberWithUser } from '@/types';
import { Settings } from '@/components/Settings';
import { noiseCancellationService } from '@/services/noiseCancellation';
import './ChannelSidebar.css';
```

With:

```tsx
import { useState, useEffect, useMemo } from 'react';
import type { Server, Channel, User, MemberWithUser } from '@/types';
import { Settings } from '@/components/Settings';
import { Avatar } from '@/components/Avatar';
import { noiseCancellationService } from '@/services/noiseCancellation';
import './ChannelSidebar.css';
```

- [ ] **Step 2: Track avatar alongside username in the member lookup**

Replace:

```tsx
  const usernameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.user_id, m.username);
    return map;
  }, [members]);

  const resolveUsername = (userId: string): string => usernameById.get(userId) ?? userId.slice(0, 8);
```

With:

```tsx
  const memberById = useMemo(() => {
    const map = new Map<string, MemberWithUser>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const resolveUsername = (userId: string): string => memberById.get(userId)?.username ?? userId.slice(0, 8);
  const resolveAvatarUrl = (userId: string): string | undefined => memberById.get(userId)?.avatar_url;
```

- [ ] **Step 3: Use `Avatar` for the voice participant tile**

Replace:

```tsx
                          <div className="voice-participant-avatar">
                            {resolveUsername(userId).charAt(0).toUpperCase()}
                          </div>
```

With:

```tsx
                          <Avatar
                            url={resolveAvatarUrl(userId)}
                            username={resolveUsername(userId)}
                            className="voice-participant-avatar"
                          />
```

- [ ] **Step 4: Use `Avatar` for the self user-panel**

Replace:

```tsx
          <div className="user-avatar small">
            {user?.username?.charAt(0).toUpperCase()}
          </div>
```

With:

```tsx
          <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="user-avatar small" />
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ChannelSidebar.tsx
git commit -m "VYC-42 Show real avatars in ChannelSidebar"
```

---

## Task 12: `UserList` — real avatars + live refresh

**Files:**
- Modify: `client/src/components/UserList.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 8), existing `wsService.on` pattern.

- [ ] **Step 1: Import `Avatar`**

Replace:

```tsx
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { callService } from '@/services/call';
import type { User } from '@/types';
import './UserList.css';
```

With:

```tsx
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
import type { User } from '@/types';
import './UserList.css';
```

- [ ] **Step 2: Refresh the list on avatar changes too**

Replace:

```tsx
    wsService.on('user_joined', () => {
      loadOnlineUsers();
    });

    wsService.on('user_left', () => {
      loadOnlineUsers();
    });
  }, []);
```

With:

```tsx
    wsService.on('user_joined', () => {
      loadOnlineUsers();
    });

    wsService.on('user_left', () => {
      loadOnlineUsers();
    });

    wsService.on('user_updated', () => {
      loadOnlineUsers();
    });
  }, []);
```

- [ ] **Step 3: Use `Avatar` for the list item**

Replace:

```tsx
          <div className="user-avatar list online">
            {u.username.charAt(0).toUpperCase()}
          </div>
```

With:

```tsx
          <Avatar url={u.avatar_url} username={u.username} className="user-avatar list online" />
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/UserList.tsx
git commit -m "VYC-42 Show real avatars in UserList, refresh on user_updated"
```

---

## Task 13: `ChatArea` — real avatars for message authors

**Files:**
- Modify: `client/src/components/ChatArea.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 8), `serverStore.members` (already live-patched via Task 10).

- [ ] **Step 1: Import `Avatar`**

Add `import { Avatar } from '@/components/Avatar';` to the import block at the top of `client/src/components/ChatArea.tsx` (alongside the other `@/components/*` imports).

- [ ] **Step 2: Widen `userCache` to carry avatar_url**

Find the state declaration:

```tsx
  const [userCache, setUserCache] = useState<Map<string, string>>(new Map());
```

Replace with:

```tsx
  const [userCache, setUserCache] = useState<Map<string, { username: string; avatar_url?: string }>>(new Map());
```

- [ ] **Step 3: Update the username-fetch effect to also cache avatar_url**

Replace:

```tsx
      for (const uid of userIds) {
        try {
          const fetchedUser = await apiService.getUserById(uid) as User;
          setUserCache((prev) => {
            const next = new Map(prev);
            next.set(fetchedUser.id, fetchedUser.username);
            return next;
          });
        } catch {
          setUserCache((prev) => {
            const next = new Map(prev);
            next.set(uid, uid.slice(0, 8));
            return next;
          });
        }
      }
```

With:

```tsx
      for (const uid of userIds) {
        try {
          const fetchedUser = await apiService.getUserById(uid) as User;
          setUserCache((prev) => {
            const next = new Map(prev);
            next.set(fetchedUser.id, { username: fetchedUser.username, avatar_url: fetchedUser.avatar_url });
            return next;
          });
        } catch {
          setUserCache((prev) => {
            const next = new Map(prev);
            next.set(uid, { username: uid.slice(0, 8) });
            return next;
          });
        }
      }
```

- [ ] **Step 4: Update the incoming-message cache-fill effect the same way**

Replace:

```tsx
          try {
            const fetchedUser = await apiService.getUserById(msg.user_id as string) as User;
            setUserCache((prev) => {
              const next = new Map(prev);
              next.set(fetchedUser.id, fetchedUser.username);
              return next;
            });
          } catch {
            setUserCache((prev) => {
              const next = new Map(prev);
              next.set(msg.user_id as string, 'Unknown');
              return next;
            });
          }
```

With:

```tsx
          try {
            const fetchedUser = await apiService.getUserById(msg.user_id as string) as User;
            setUserCache((prev) => {
              const next = new Map(prev);
              next.set(fetchedUser.id, { username: fetchedUser.username, avatar_url: fetchedUser.avatar_url });
              return next;
            });
          } catch {
            setUserCache((prev) => {
              const next = new Map(prev);
              next.set(msg.user_id as string, { username: 'Unknown' });
              return next;
            });
          }
```

- [ ] **Step 5: Resolve avatar_url at render time, preferring the live server member list**

Replace:

```tsx
              // Get username: from cache or current user
              const displayName = isFromMe
                ? user!.username
                : (userCache.get(msg.user_id) || msg.user_id.slice(0, 8));
```

With:

```tsx
              // Username/avatar: server member list first (kept live via
              // user_updated WS events, see AppPage), then the per-message
              // fetch cache as fallback for authors who left the server.
              const member = !isFromMe ? members.find((m) => m.user_id === msg.user_id) : undefined;
              const cached = !isFromMe ? userCache.get(msg.user_id) : undefined;
              const displayName = isFromMe
                ? user!.username
                : (member?.username ?? cached?.username ?? msg.user_id.slice(0, 8));
              const avatarUrl = isFromMe ? user?.avatar_url : (member?.avatar_url ?? cached?.avatar_url);
```

- [ ] **Step 6: Render `Avatar` instead of the initials div, both places**

Replace:

```tsx
                  {!isCompact && !isFromMe && (
                    <div className="message-avatar">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
```

With:

```tsx
                  {!isCompact && !isFromMe && (
                    <Avatar url={avatarUrl} username={displayName} className="message-avatar" />
                  )}
```

Replace:

```tsx
                  {!isCompact && isFromMe && (
                    <div className="message-avatar self">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
```

With:

```tsx
                  {!isCompact && isFromMe && (
                    <Avatar url={avatarUrl} username={displayName} className="message-avatar self" />
                  )}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/ChatArea.tsx
git commit -m "VYC-42 Show real avatars for message authors in ChatArea"
```

---

## Task 14: `AvatarCropModal` — canvas crop UI

**Files:**
- Create: `client/src/components/AvatarCropModal.tsx`
- Create: `client/src/components/AvatarCropModal.css`

**Interfaces:**
- Produces: `AvatarCropModal({ file, onCancel, onUpload }: { file: File; onCancel: () => void; onUpload: (blob: Blob) => Promise<void> })`. `onUpload` resolving closes nothing by itself (caller is expected to unmount the modal on success, e.g. by clearing the `file` state that controls whether it's rendered); a rejected/thrown error from `onUpload` is caught and shown inline, modal stays open and re-submittable.

- [ ] **Step 1: Create `AvatarCropModal.css`**

```css
.avatar-crop-overlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(15, 17, 23, 0.65);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s var(--ease-out);
}

.avatar-crop-modal {
  background: var(--bg-primary);
  border-radius: var(--radius-xl);
  width: 92%;
  max-width: 420px;
  box-shadow: var(--shadow-xl);
  border: 1px solid var(--border-subtle);
  animation: scaleIn 0.25s var(--ease-out);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}

.avatar-crop-modal h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  align-self: flex-start;
}

.avatar-crop-canvas {
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  cursor: grab;
  touch-action: none;
}

.avatar-crop-canvas:active {
  cursor: grabbing;
}

.avatar-crop-zoom {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
}

.avatar-crop-zoom input[type="range"] {
  flex: 1;
  accent-color: var(--brand-color);
}

.avatar-crop-error {
  width: 100%;
  font-size: 12px;
  color: var(--yellow-500);
  background: var(--yellow-50);
  padding: 8px 14px;
  border-radius: var(--radius-md);
  margin: 0;
  font-weight: 500;
  border: 1px solid rgba(245, 158, 11, 0.15);
}

.avatar-crop-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}

.avatar-crop-btn {
  padding: 9px 18px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
  border: 1.5px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
}

.avatar-crop-btn:hover {
  background: var(--bg-hover);
}

.avatar-crop-btn.primary {
  border-color: var(--brand-color);
  background: var(--brand-color);
  color: var(--text-inverse);
}

.avatar-crop-btn.primary:hover {
  filter: brightness(1.05);
}

.avatar-crop-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Create `AvatarCropModal.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import './AvatarCropModal.css';

const CANVAS_SIZE = 320;
const CIRCLE_RADIUS = 130;
const CIRCLE_DIAMETER = CIRCLE_RADIUS * 2;
const OUTPUT_SIZE = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface Offset {
  x: number;
  y: number;
}

interface AvatarCropModalProps {
  file: File;
  onCancel: () => void;
  onUpload: (blob: Blob) => Promise<void>;
}

function clampOffset(x: number, y: number, zoom: number, img: HTMLImageElement, baseScale: number): Offset {
  const drawWidth = img.naturalWidth * baseScale * zoom;
  const drawHeight = img.naturalHeight * baseScale * zoom;
  const maxX = Math.max(0, (drawWidth - CIRCLE_DIAMETER) / 2);
  const maxY = Math.max(0, (drawHeight - CIRCLE_DIAMETER) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
}

// Renders the crop into a plain square 512×512 JPEG — no transparency, no
// baked-in circle. The circular look comes purely from CSS border-radius
// wherever the avatar is displayed; clipping a circle here would leave the
// square's corners transparent, which JPEG (no alpha channel) turns black.
function exportCroppedBlob(img: HTMLImageElement, baseScale: number, zoom: number, offset: Offset): Promise<Blob> {
  const output = document.createElement('canvas');
  output.width = OUTPUT_SIZE;
  output.height = OUTPUT_SIZE;
  const ctx = output.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is not supported'));

  const ratio = OUTPUT_SIZE / CIRCLE_DIAMETER;
  const drawWidth = img.naturalWidth * baseScale * zoom * ratio;
  const drawHeight = img.naturalHeight * baseScale * zoom * ratio;
  ctx.translate(OUTPUT_SIZE / 2 + offset.x * ratio, OUTPUT_SIZE / 2 + offset.y * ratio);
  ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  return new Promise((resolve, reject) => {
    output.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to export image'))),
      'image/jpeg',
      0.92
    );
  });
}

export function AvatarCropModal({ file, onCancel, onUpload }: AvatarCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const lastPointRef = useRef<Offset>({ x: 0, y: 0 });

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.max(CIRCLE_DIAMETER / image.naturalWidth, CIRCLE_DIAMETER / image.naturalHeight);
      setBaseScale(scale);
      setZoom(MIN_ZOOM);
      setOffset({ x: 0, y: 0 });
      setImg(image);
    };
    image.onerror = () => setError('Не удалось открыть изображение');
    image.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const drawWidth = img.naturalWidth * baseScale * zoom;
    const drawHeight = img.naturalHeight * baseScale * zoom;
    ctx.save();
    ctx.translate(CANVAS_SIZE / 2 + offset.x, CANVAS_SIZE / 2 + offset.y);
    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(15, 17, 23, 0.6)';
    ctx.beginPath();
    ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }, [img, baseScale, zoom, offset]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current || !img) return;
    const dx = e.clientX - lastPointRef.current.x;
    const dy = e.clientY - lastPointRef.current.y;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => clampOffset(prev.x + dx, prev.y + dy, zoom, img, baseScale));
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!img) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
    setZoom(next);
    setOffset((prev) => clampOffset(prev.x, prev.y, next, img, baseScale));
  };

  const handleZoomSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!img) return;
    const next = parseFloat(e.target.value);
    setZoom(next);
    setOffset((prev) => clampOffset(prev.x, prev.y, next, img, baseScale));
  };

  const handleSaveClick = async () => {
    if (!img) return;
    setError(null);
    setSaving(true);
    try {
      const blob = await exportCroppedBlob(img, baseScale, zoom, offset);
      await onUpload(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить аватар. Попробуйте ещё раз');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="avatar-crop-overlay" onClick={saving ? undefined : onCancel}>
      <div className="avatar-crop-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Обрезка аватара</h3>

        <canvas
          ref={canvasRef}
          className="avatar-crop-canvas"
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
        />

        <div className="avatar-crop-zoom">
          <span>🔍</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            onChange={handleZoomSlider}
            disabled={!img}
          />
        </div>

        {error && <p className="avatar-crop-error">{error}</p>}

        <div className="avatar-crop-actions">
          <button type="button" className="avatar-crop-btn" onClick={onCancel} disabled={saving}>
            Отмена
          </button>
          <button
            type="button"
            className="avatar-crop-btn primary"
            onClick={handleSaveClick}
            disabled={!img || saving}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (component isn't used yet, checks it type-checks standalone).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/AvatarCropModal.tsx client/src/components/AvatarCropModal.css
git commit -m "VYC-42 Add canvas-based AvatarCropModal"
```

---

## Task 15: Extract Audio/Video/Appearance settings into their own components

**Files:**
- Create: `client/src/components/settings/AudioSettings.tsx`
- Create: `client/src/components/settings/VideoSettings.tsx`
- Create: `client/src/components/settings/AppearanceSettings.tsx`

**Interfaces:**
- Produces: `AudioSettings()`, `VideoSettings()`, `AppearanceSettings()` — each a self-contained React component with no props, reusing the global `.settings-section`/`.setting-item`/etc. classes from `Settings.css` (loaded by the parent `Settings.tsx`, not re-imported here).

This is a mechanical extraction of existing JSX/logic out of `Settings.tsx` (rewritten in Task 16) — no behavior change.

- [ ] **Step 1: Create `client/src/components/settings/AudioSettings.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { noiseCancellationService, NoiseCancellationService } from '@/services/noiseCancellation';
import { audioService } from '@/services/audio';

export function AudioSettings() {
  const [noiseCancellation, setNoiseCancellation] = useState(false);
  const [ncLoading, setNcLoading] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [msgSound, setMsgSound] = useState(true);
  const [callSound, setCallSound] = useState(true);
  const [volume, setVolume] = useState(0.5);

  useEffect(() => {
    setIsSupported(NoiseCancellationService.isSupported());
    // Подписка не выдаёт текущее состояние при регистрации — без явного чтения
    // default-on не виден до первого notify() (старта звонка).
    const initial = noiseCancellationService.getState();
    setNoiseCancellation(initial.isEnabled);
    setNcLoading(initial.isLoading);
    const unsub = noiseCancellationService.onStateChange((state) => {
      setNoiseCancellation(state.isEnabled);
      setNcLoading(state.isLoading);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const settings = audioService.getSettings();
    setMsgSound(settings.messageSound);
    setCallSound(settings.callSound);
    setVolume(settings.volume);
  }, []);

  const handleToggleNoiseCancellation = async () => {
    if (ncLoading) return;
    try {
      // Вне звонка меняет только персистентный флаг (микрофон не захватывается);
      // в звонке сервис перекоммутирует активную аудиоцепочку.
      await noiseCancellationService.setEnabled(!noiseCancellation);
    } catch (err) {
      console.error('Failed to toggle noise cancellation:', err);
    }
  };

  return (
    <div className="settings-section">
      <h3>Audio</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>Message Notifications</label>
          <p className="setting-description">Play a sound when you receive a new message</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={msgSound}
            onChange={(e) => {
              setMsgSound(e.target.checked);
              audioService.updateSettings({ messageSound: e.target.checked });
            }}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>Call Sounds</label>
          <p className="setting-description">Play ringtone and call status sounds</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={callSound}
            onChange={(e) => {
              setCallSound(e.target.checked);
              audioService.updateSettings({ callSound: e.target.checked });
            }}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>Volume</label>
          <p className="setting-description">Adjust notification volume</p>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            audioService.setVolume(v);
          }}
          style={{ width: 120, accentColor: 'var(--brand-color)' }}
        />
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>Test Sounds</label>
          <p className="setting-description">Preview notification sounds</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => audioService.playMessage()}
            style={{
              padding: '6px 14px',
              border: '1.5px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            💬 Message
          </button>
          <button
            onClick={() => {
              audioService.startRingtone();
              setTimeout(() => audioService.stopRingtone(), 3000);
            }}
            style={{
              padding: '6px 14px',
              border: '1.5px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            📞 Ring
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>Noise Cancellation (DeepFilterNet3)</label>
          <p className="setting-description">
            {ncLoading
              ? 'Loading DeepFilterNet3 model...'
              : 'AI noise suppression — removes background noise from your mic'}
          </p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={noiseCancellation}
            onChange={handleToggleNoiseCancellation}
            disabled={!isSupported || ncLoading}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      {!isSupported && (
        <p className="setting-warning">
          Noise cancellation requires AudioWorklet support (Chrome/Edge/Firefox 76+)
        </p>
      )}

      <div className="setting-item">
        <div className="setting-info">
          <label>Input Device</label>
          <p className="setting-description">
            Select your microphone
          </p>
        </div>
        <select className="setting-select">
          <option>Default Microphone</option>
        </select>
      </div>

      <div className="setting-item">
        <div className="setting-info">
          <label>Output Device</label>
          <p className="setting-description">
            Select your speakers
          </p>
        </div>
        <select className="setting-select">
          <option>Default Speakers</option>
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `client/src/components/settings/VideoSettings.tsx`**

```tsx
export function VideoSettings() {
  return (
    <div className="settings-section">
      <h3>Video</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>Camera</label>
          <p className="setting-description">
            Select your camera
          </p>
        </div>
        <select className="setting-select">
          <option>Default Camera</option>
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `client/src/components/settings/AppearanceSettings.tsx`**

```tsx
import { useThemeStore } from '@/stores/themeStore';

export function AppearanceSettings() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="settings-section">
      <h3>Appearance</h3>

      <div className="setting-item">
        <div className="setting-info">
          <label>Theme</label>
          <p className="setting-description">Choose between light and dark interface</p>
        </div>
        <select
          className="setting-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (not wired up yet, checks standalone validity).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/settings/AudioSettings.tsx client/src/components/settings/VideoSettings.tsx client/src/components/settings/AppearanceSettings.tsx
git commit -m "VYC-42 Extract Audio/Video/Appearance settings into own components"
```

---

## Task 16: `Settings.tsx` — Discord-style tab shell

**Files:**
- Modify: `client/src/components/Settings.tsx`
- Modify: `client/src/components/Settings.css`

**Interfaces:**
- Consumes: `AudioSettings`/`VideoSettings`/`AppearanceSettings` (Task 15), `ProfileSettings` (Task 17 — this task references it, Task 17 creates the file; do this task's `Settings.tsx` edit and Task 17 together if executing sequentially, or stub the import first and fill in Task 17. Recommended order: do Task 17 immediately after this one before testing in-browser).
- Produces: no change to `Settings`'s public props (`{ isOpen, onClose }`), only internal restructuring.

- [ ] **Step 1: Replace the full contents of `client/src/components/Settings.tsx`**

```tsx
import { useState } from 'react';
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { AudioSettings } from '@/components/settings/AudioSettings';
import { VideoSettings } from '@/components/settings/VideoSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import './Settings.css';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'profile' | 'audio' | 'video' | 'appearance';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'profile', label: 'Профиль' },
  { id: 'audio', label: 'Аудио' },
  { id: 'video', label: 'Видео' },
  { id: 'appearance', label: 'Внешний вид' },
];

export function Settings({ isOpen, onClose }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Настройки</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          <nav className="settings-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {activeTab === 'profile' && <ProfileSettings />}
            {activeTab === 'audio' && <AudioSettings />}
            {activeTab === 'video' && <VideoSettings />}
            {activeTab === 'appearance' && <AppearanceSettings />}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add tab-shell CSS**

In `client/src/components/Settings.css`, insert the following block after the existing `.settings-content { ... }` rule (after its closing `}`, before `.settings-section { ... }`):

```css

.settings-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.settings-tabs {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.settings-tab {
  text-align: left;
  padding: 10px 14px;
  border: none;
  border-radius: var(--radius-md);
  background: none;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
}

.settings-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.settings-tab.active {
  background: var(--brand-subtle);
  color: var(--brand-color);
}
```

The existing `.settings-content { flex: 1; overflow-y: auto; padding: 28px; }` rule is reused unchanged — it now applies as the content pane next to `.settings-tabs` instead of directly under `.settings-modal`, same visual padding as before.

- [ ] **Step 2 note:** This task's `Settings.tsx` imports `ProfileSettings` from `@/components/settings/ProfileSettings`, which does not exist until Task 17. Do not run `tsc`/dev server standalone after this task — proceed straight to Task 17, then verify both together.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Settings.tsx client/src/components/Settings.css
git commit -m "VYC-42 Restructure Settings into a Discord-style tab shell"
```

---

## Task 17: `ProfileSettings` — avatar upload UI

**Files:**
- Create: `client/src/components/settings/ProfileSettings.tsx`
- Create: `client/src/components/settings/ProfileSettings.css`

**Interfaces:**
- Consumes: `useAuthStore` (`user`, `updateUser` from Task 9), `apiService.uploadAvatar`/`removeAvatar` (Task 9), `Avatar` (Task 8), `AvatarCropModal` (Task 14).
- Produces: `ProfileSettings()` — no props, self-contained tab content.

- [ ] **Step 1: Create `client/src/components/settings/ProfileSettings.css`**

```css
.profile-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.profile-avatar-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 24px 0 32px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 8px;
}

.profile-avatar-large {
  width: 96px;
  height: 96px;
  min-width: 96px;
  border-radius: var(--radius-full);
  background: linear-gradient(135deg, var(--brand-300), var(--brand-500));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34px;
  font-weight: 700;
  color: var(--text-inverse);
  object-fit: cover;
}

.profile-avatar-actions {
  display: flex;
  gap: 10px;
}

.profile-avatar-btn {
  padding: 8px 16px;
  border: 1.5px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition);
}

.profile-avatar-btn:hover {
  border-color: var(--brand-color);
  color: var(--brand-color);
}

.profile-avatar-btn.secondary {
  color: var(--text-muted);
}

.profile-avatar-btn.secondary:hover {
  border-color: var(--red-color);
  color: var(--red-color);
}

.profile-avatar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Create `client/src/components/settings/ProfileSettings.tsx`**

```tsx
import { useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { apiService } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { AvatarCropModal } from '@/components/AvatarCropModal';
import './ProfileSettings.css';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function ProfileSettings() {
  const { user, updateUser } = useAuthStore();
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setPickError('Неподдерживаемый формат. Разрешены PNG, JPG, JPEG');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPickError('Файл слишком большой. Максимум 2 МБ');
      return;
    }

    setPickError(null);
    setCropFile(file);
  };

  const handleUpload = async (blob: Blob): Promise<void> => {
    const updated = await apiService.uploadAvatar(blob);
    updateUser({ avatar_url: updated.avatar_url });
    setCropFile(null);
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const updated = await apiService.removeAvatar();
      updateUser({ avatar_url: updated.avatar_url });
    } catch (err) {
      setPickError(err instanceof Error ? err.message : 'Не удалось удалить аватар');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="profile-settings">
      <div className="profile-avatar-block">
        <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="profile-avatar-large" />
        <div className="profile-avatar-actions">
          <button
            type="button"
            className="profile-avatar-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            Изменить аватар
          </button>
          {user?.avatar_url && (
            <button
              type="button"
              className="profile-avatar-btn secondary"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? 'Удаление...' : 'Удалить аватар'}
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
        {pickError && <p className="setting-warning">{pickError}</p>}
      </div>

      <div className="settings-section">
        <h3>Учётная запись</h3>
        <div className="setting-item">
          <div className="setting-info">
            <label>Имя пользователя</label>
            <p className="setting-description">{user?.username}</p>
          </div>
        </div>
        <div className="setting-item">
          <div className="setting-info">
            <label>Email</label>
            <p className="setting-description">{user?.email}</p>
          </div>
        </div>
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onUpload={handleUpload}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors — this also validates Task 16's `Settings.tsx` import of `ProfileSettings`.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/settings/ProfileSettings.tsx client/src/components/settings/ProfileSettings.css
git commit -m "VYC-42 Add ProfileSettings tab with avatar upload/remove"
```

---

## Task 18: End-to-end manual QA

**Files:** none (verification only).

- [ ] **Step 1: Build both sides**

Run: `cd server && go build ./... && go test ./...`
Expected: build succeeds, all tests pass.

Run: `cd client && npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 2: Start the stack locally**

Run the project's normal dev startup (Postgres/Redis + `go run ./cmd/api` from `server/`, plus `npm run dev:vite` from `client/`, per the existing project workflow — see `project_workflows` memory / repo docs). Confirm `UPLOAD_DIR` resolves to a writable path (default `./uploads` relative to the API's working directory) and the directory gets created on first upload.

- [ ] **Step 3: Manual QA checklist (two logged-in sessions/browsers to check live propagation)**

- [ ] Open Settings → the modal now shows a left-hand tab list (Профиль/Аудио/Видео/Внешний вид) with Профиль active by default; Audio/Video/Appearance tabs behave exactly as before (noise cancellation toggle, theme switch, etc. still work).
- [ ] On the Профиль tab, click "Изменить аватар", pick a PNG or JPEG under 2MB — the crop modal opens showing the image inside a circular guide.
- [ ] Drag the image to pan, use the slider (and mouse wheel) to zoom — the image never leaves gaps inside the circle at any zoom level.
- [ ] Click "Сохранить" — modal closes, the large avatar in Профиль updates immediately, and the small avatar in the bottom-left user panel (`ChannelSidebar`) updates too.
- [ ] Open the members list (`UserList`) and a text channel with messages from this user — both now show the real avatar instead of initials.
- [ ] In a second logged-in session (different browser/profile), confirm the first user's avatar updates live everywhere it's visible (member list, chat messages, voice channel participant tile if in a voice channel) without a page reload.
- [ ] Try selecting a `.gif` or `.webp` file — client rejects it immediately with the format error message, crop modal does not open.
- [ ] Try selecting a file over 2MB — client rejects it immediately with the size error message.
- [ ] Click "Отмена" in the crop modal — modal closes, no request is sent (verify in Network tab), avatar unchanged.
- [ ] Click "Удалить аватар" — avatar reverts to initials everywhere (including the second session, live).
- [ ] Simulate a server error (e.g. temporarily stop the API mid-upload, or throttle network to force a timeout) — the crop modal stays open showing an error message, and clicking "Сохранить" again retries without needing to reselect/re-crop the file.
- [ ] Resize the browser to a narrow/mobile width — Settings tab sidebar and crop modal remain usable (no horizontal overflow, buttons stay reachable).

- [ ] **Step 4: No commit for this task** — it is a verification pass. If any checklist item fails, fix the relevant task's code, re-run its tests, commit the fix referencing which QA step it addresses, then resume the checklist.

---

## Self-Review Notes

- **Spec coverage:** every requirement in `docs/superpowers/specs/2026-07-21-user-avatar-upload-design.md` maps to a task — Profile tab (16, 17), format/size validation client+server (17, 3, 6), crop UI (14), local storage behind an interface (1), live WS propagation (4, 10, 11, 12, 13), error handling with retry-without-reselect (14, 17), tests per the spec's Go testing section (1, 3, 4, 6), manual QA per the spec's frontend testing section (18), `UPLOAD_DIR` deploy note (5).
- **Placeholder scan:** no TBD/TODO markers; every step has complete code.
- **Type consistency:** `NewUserUseCase(userRepo, storage)` (Task 3) matches its Task 7 call site; `NewUserHandler(userUseCase, hub, log)` (Task 6) matches its Task 7 call site and Task 6's own test updates; `Hub.BroadcastUserUpdate(userID uuid.UUID, avatarURL *string)` (Task 4) matches its Task 6 call sites (`user.AvatarURL` is already `*string` on `domain.User`); `Avatar({ url, username, className })` (Task 8) matches every call site in Tasks 11–13, 17; `AvatarCropModal({ file, onCancel, onUpload })` (Task 14) matches its Task 17 call site; `AuthState.updateUser`/`ServerState.patchMemberAvatar` (Task 9) match their Task 10, 17 call sites.
