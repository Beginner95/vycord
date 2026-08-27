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

func (m *MockStorage) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	args := m.Called(ctx, key)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(io.ReadSeekCloser), args.Error(1)
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
