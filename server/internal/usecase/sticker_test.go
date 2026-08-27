package usecase_test

import (
	"context"
	"io"
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

func (f *fakeStickerStorage) Save(_ context.Context, _ string, _ io.Reader, _ string) (string, error) {
	return f.returnedURL, nil
}
func (f *fakeStickerStorage) Delete(_ context.Context, _ string) error { return nil }
func (f *fakeStickerStorage) Open(_ context.Context, _ string) (io.ReadSeekCloser, error) {
	return nil, nil
}

// testPNG — валидный PNG 32x32, удовлетворяющий validateImage.
var testPNG = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00 \x00\x00\x00 \x08\x06\x00\x00\x00szz\xf4\x00\x00\x00\x00IEND\xaeB`\x82")

func TestStickerUseCase_Create_Denied(t *testing.T) {
	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", mock.Anything).Return(&domain.Server{}, nil)

	perms := &MockPermissionUseCase{}
	perms.On("Resolve", mock.Anything, mock.Anything).Return(domain.PermissionSet{}, nil)

	uc := usecase.NewStickerUseCase(&MockStickerRepository{}, srvRepo, perms, &fakeStickerStorage{})
	_, err := uc.CreateSticker(uuid.New(), uuid.New(), "x", nil)
	assert.ErrorIs(t, err, domain.ErrStickerForbidden)
}

func TestStickerUseCase_Create_ServerNotFound(t *testing.T) {
	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", mock.Anything).Return(nil, domain.ErrServerNotFound)

	uc := usecase.NewStickerUseCase(new(MockStickerRepository), srvRepo, new(MockPermissionUseCase), &fakeStickerStorage{})
	_, err := uc.CreateSticker(uuid.New(), uuid.New(), "x", testPNG)
	assert.ErrorIs(t, err, domain.ErrServerNotFound)
}

func TestStickerUseCase_Create_ImageRequired(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID}, nil)

	uc := usecase.NewStickerUseCase(new(MockStickerRepository), srvRepo, permsWith(serverID, userID, domain.PermManageServer), &fakeStickerStorage{})
	_, err := uc.CreateSticker(serverID, userID, "x", nil)
	assert.ErrorIs(t, err, domain.ErrStickerImageRequired)
}

func TestStickerUseCase_Create_NameRequired(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID}, nil)

	uc := usecase.NewStickerUseCase(new(MockStickerRepository), srvRepo, permsWith(serverID, userID, domain.PermManageServer), &fakeStickerStorage{})
	_, err := uc.CreateSticker(serverID, userID, "", testPNG)
	assert.ErrorIs(t, err, domain.ErrStickerNameRequired)
}

func TestStickerUseCase_Create_StoresImage(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID}, nil)

	stickerRepo := new(MockStickerRepository)
	stickerRepo.On("Create", mock.AnythingOfType("*domain.Sticker")).Return(nil)

	uc := usecase.NewStickerUseCase(stickerRepo, srvRepo, permsWith(serverID, userID, domain.PermManageServer), &fakeStickerStorage{returnedURL: "http://cdn/stickers/x.png"})

	got, err := uc.CreateSticker(serverID, userID, "  hello  ", testPNG)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, serverID, got.ServerID)
	assert.Equal(t, userID, got.CreatedBy)
	assert.Equal(t, "hello", got.Name)
	assert.Equal(t, "http://cdn/stickers/x.png", got.ImageURL)
	stickerRepo.AssertCalled(t, "Create", mock.AnythingOfType("*domain.Sticker"))
}

func TestStickerUseCase_Delete_Denied(t *testing.T) {
	perms := &MockPermissionUseCase{}
	perms.On("Resolve", mock.Anything, mock.Anything).Return(domain.PermissionSet{}, nil)

	uc := usecase.NewStickerUseCase(new(MockStickerRepository), new(MockServerRepository), perms, &fakeStickerStorage{})
	err := uc.DeleteSticker(uuid.New(), uuid.New(), uuid.New())
	assert.ErrorIs(t, err, domain.ErrStickerForbidden)
}

func TestStickerUseCase_Delete_CrossServer(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()
	foreignSticker := &domain.Sticker{ID: uuid.New(), ServerID: uuid.New()}

	stickerRepo := new(MockStickerRepository)
	stickerRepo.On("GetByID", foreignSticker.ID).Return(foreignSticker, nil)

	uc := usecase.NewStickerUseCase(stickerRepo, new(MockServerRepository), permsWith(serverID, userID, domain.PermManageServer), &fakeStickerStorage{})
	err := uc.DeleteSticker(serverID, foreignSticker.ID, userID)
	assert.ErrorIs(t, err, domain.ErrStickerNotFound)
}

func TestStickerUseCase_Delete_DeletesSticker(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()
	sticker := &domain.Sticker{ID: uuid.New(), ServerID: serverID, ImageURL: "http://cdn/stickers/y.png"}

	stickerRepo := new(MockStickerRepository)
	stickerRepo.On("GetByID", sticker.ID).Return(sticker, nil)
	stickerRepo.On("Delete", sticker.ID).Return(nil)

	uc := usecase.NewStickerUseCase(stickerRepo, new(MockServerRepository), permsWith(serverID, userID, domain.PermManageServer), &fakeStickerStorage{})
	err := uc.DeleteSticker(serverID, sticker.ID, userID)
	assert.NoError(t, err)
	stickerRepo.AssertCalled(t, "Delete", sticker.ID)
}