package usecase_test

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type MockQuotaUseCase struct{ mock.Mock }

func (m *MockQuotaUseCase) For(userID uuid.UUID) (*domain.Quota, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Quota), args.Error(1)
}

func (m *MockQuotaUseCase) CheckUpload(userID uuid.UUID, size int64) error {
	return m.Called(userID, size).Error(0)
}

func (m *MockQuotaUseCase) ExpiresAt(userID uuid.UUID, now time.Time) (*time.Time, error) {
	args := m.Called(userID, now)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*time.Time), args.Error(1)
}

// attachFixture собирает usecase со всеми моками и правами по умолчанию.
type attachFixture struct {
	uc        domain.AttachmentUseCase
	repo      *MockAttachmentRepository
	chRepo    *MockChannelRepository
	perms     *MockPermissionUseCase
	quota     *MockQuotaUseCase
	storage   *MockStorage
	userID    uuid.UUID
	channelID uuid.UUID
	serverID  uuid.UUID
}

func newAttachFixture(t *testing.T) *attachFixture {
	t.Helper()
	f := &attachFixture{
		repo:      new(MockAttachmentRepository),
		chRepo:    new(MockChannelRepository),
		perms:     new(MockPermissionUseCase),
		quota:     new(MockQuotaUseCase),
		storage:   new(MockStorage),
		userID:    uuid.New(),
		channelID: uuid.New(),
		serverID:  uuid.New(),
	}
	f.chRepo.On("GetByID", f.channelID).Return(&domain.Channel{ID: f.channelID, ServerID: f.serverID}, nil)
	f.perms.On("Resolve", f.serverID, f.userID).Return(domain.PermissionSet{Bits: domain.PermAll}, nil)
	f.uc = usecase.NewAttachmentUseCase(f.repo, f.chRepo, f.perms, f.quota, f.storage)
	return f
}

func (f *attachFixture) upload(name string, data []byte) domain.AttachmentUpload {
	return domain.AttachmentUpload{
		ChannelID: f.channelID,
		UserID:    f.userID,
		FileName:  name,
		Size:      int64(len(data)),
		Content:   bytes.NewReader(data),
	}
}

func TestUploadStoresFileAndRow(t *testing.T) {
	f := newAttachFixture(t)
	data := []byte("%PDF-1.7 fake pdf payload")
	f.quota.On("CheckUpload", f.userID, int64(len(data))).Return(nil)
	f.quota.On("ExpiresAt", f.userID, mock.Anything).Return((*time.Time)(nil), nil)
	f.storage.On("Save", mock.Anything, mock.Anything, mock.Anything, "application/pdf").Return("/uploads/x", nil)
	f.repo.On("Create", mock.Anything).Return(nil)

	got, err := f.uc.Upload(f.upload("отчёт.pdf", data))

	require.NoError(t, err)
	assert.Equal(t, domain.AttachmentKindFile, got.Kind)
	assert.Equal(t, "отчёт.pdf", got.FileName)
	assert.Equal(t, int64(len(data)), got.SizeBytes)
	assert.Nil(t, got.MessageID, "свежее вложение не привязано к сообщению")
	assert.Contains(t, got.StorageKey, f.channelID.String(), "ключ раскладывается по каналам")
	f.storage.AssertExpectations(t)
	f.repo.AssertExpectations(t)
}

func TestUploadSanitizesFileName(t *testing.T) {
	f := newAttachFixture(t)
	data := []byte("plain text payload")
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(nil)
	f.quota.On("ExpiresAt", f.userID, mock.Anything).Return((*time.Time)(nil), nil)
	f.storage.On("Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return("/uploads/x", nil)
	f.repo.On("Create", mock.Anything).Return(nil)

	got, err := f.uc.Upload(f.upload("../../etc/passwd", data))

	require.NoError(t, err)
	assert.Equal(t, ".._.._etc_passwd", got.FileName)
}

func TestUploadRejectsWhenQuotaSaysNo(t *testing.T) {
	f := newAttachFixture(t)
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(domain.ErrAttachmentTooLarge)

	_, err := f.uc.Upload(f.upload("big.bin", []byte("payload")))

	assert.ErrorIs(t, err, domain.ErrAttachmentTooLarge)
	f.storage.AssertNotCalled(t, "Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	f.repo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestUploadRejectsWithoutSendMessagesPermission(t *testing.T) {
	f := &attachFixture{
		repo: new(MockAttachmentRepository), chRepo: new(MockChannelRepository),
		perms: new(MockPermissionUseCase), quota: new(MockQuotaUseCase), storage: new(MockStorage),
		userID: uuid.New(), channelID: uuid.New(), serverID: uuid.New(),
	}
	f.chRepo.On("GetByID", f.channelID).Return(&domain.Channel{ID: f.channelID, ServerID: f.serverID}, nil)
	f.perms.On("Resolve", f.serverID, f.userID).Return(domain.PermissionSet{Bits: domain.PermViewChannels}, nil)
	f.uc = usecase.NewAttachmentUseCase(f.repo, f.chRepo, f.perms, f.quota, f.storage)

	_, err := f.uc.Upload(f.upload("a.txt", []byte("data")))

	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.storage.AssertNotCalled(t, "Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestUploadRemovesFileWhenDatabaseFails(t *testing.T) {
	// Иначе на диске остаётся файл, на который никто уже не сошлётся.
	f := newAttachFixture(t)
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(nil)
	f.quota.On("ExpiresAt", f.userID, mock.Anything).Return((*time.Time)(nil), nil)
	f.storage.On("Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return("/uploads/x", nil)
	f.repo.On("Create", mock.Anything).Return(errors.New("db is down"))
	f.storage.On("Delete", mock.Anything, mock.Anything).Return(nil)

	_, err := f.uc.Upload(f.upload("a.txt", []byte("data")))

	require.Error(t, err)
	f.storage.AssertCalled(t, "Delete", mock.Anything, mock.Anything)
}

func TestUploadDetectsImageAndStoresThumbnail(t *testing.T) {
	f := newAttachFixture(t)
	data := pngBytes(t, 1200, 900)
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(nil)
	f.quota.On("ExpiresAt", f.userID, mock.Anything).Return((*time.Time)(nil), nil)
	f.storage.On("Save", mock.Anything, mock.Anything, mock.Anything, "image/png").Return("/uploads/x", nil)
	f.storage.On("Save", mock.Anything, mock.Anything, mock.Anything, "image/jpeg").Return("/uploads/x_thumb", nil)
	f.repo.On("Create", mock.Anything).Return(nil)

	got, err := f.uc.Upload(f.upload("pic.png", data))

	require.NoError(t, err)
	assert.Equal(t, domain.AttachmentKindImage, got.Kind)
	require.NotNil(t, got.Width)
	assert.Equal(t, 1200, *got.Width)
	assert.Equal(t, 900, *got.Height)
	assert.NotEmpty(t, got.ThumbKey)
}

func TestUploadDowngradesUndecodableImageToFile(t *testing.T) {
	// Байты с PNG-сигнатурой, но битым содержимым. Загрузку не отвергаем:
	// политика одна — что не опознали как медиа, то файл.
	f := newAttachFixture(t)
	broken := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0x00}, 64)...)
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(nil)
	f.quota.On("ExpiresAt", f.userID, mock.Anything).Return((*time.Time)(nil), nil)
	f.storage.On("Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return("/uploads/x", nil)
	f.repo.On("Create", mock.Anything).Return(nil)

	got, err := f.uc.Upload(f.upload("broken.png", broken))

	require.NoError(t, err)
	assert.Equal(t, domain.AttachmentKindFile, got.Kind)
	assert.Nil(t, got.Width)
	assert.Empty(t, got.ThumbKey)
}

func TestUploadSetsExpiryFromQuota(t *testing.T) {
	f := newAttachFixture(t)
	exp := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	f.quota.On("CheckUpload", f.userID, mock.Anything).Return(nil)
	f.quota.On("ExpiresAt", f.userID, mock.Anything).Return(&exp, nil)
	f.storage.On("Save", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return("/uploads/x", nil)
	f.repo.On("Create", mock.Anything).Return(nil)

	got, err := f.uc.Upload(f.upload("a.txt", []byte("data")))

	require.NoError(t, err)
	require.NotNil(t, got.ExpiresAt)
	assert.Equal(t, exp, *got.ExpiresAt)
}

func TestGetForUserRejectsUserWithoutChannelAccess(t *testing.T) {
	// Ушедший из приватного сервера не должен получать свежую подпись ссылки.
	f := newAttachFixture(t)
	other := uuid.New()
	att := &domain.Attachment{ID: uuid.New(), UserID: f.userID, ChannelID: f.channelID}
	f.repo.On("GetByID", att.ID).Return(att, nil)
	f.perms.On("Resolve", f.serverID, other).Return(domain.PermissionSet{Bits: 0}, nil)

	_, err := f.uc.GetForUser(att.ID, other)

	assert.ErrorIs(t, err, domain.ErrAttachmentNotFound)
}

func TestGetForUserAllowsAnyChannelMember(t *testing.T) {
	// Вложение видно всем, кто видит канал, а не только загрузившему.
	f := newAttachFixture(t)
	reader := uuid.New()
	att := &domain.Attachment{ID: uuid.New(), UserID: f.userID, ChannelID: f.channelID}
	f.repo.On("GetByID", att.ID).Return(att, nil)
	f.perms.On("Resolve", f.serverID, reader).Return(domain.PermissionSet{Bits: domain.PermViewChannels}, nil)

	got, err := f.uc.GetForUser(att.ID, reader)

	require.NoError(t, err)
	assert.Equal(t, att.ID, got.ID)
}

func TestDeleteRejectsForeignAttachment(t *testing.T) {
	f := newAttachFixture(t)
	att := &domain.Attachment{ID: uuid.New(), UserID: uuid.New(), ChannelID: f.channelID}
	f.repo.On("GetByID", att.ID).Return(att, nil)

	err := f.uc.Delete(att.ID, f.userID)

	assert.ErrorIs(t, err, domain.ErrAttachmentNotFound)
	f.repo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteRejectsAttachmentAlreadySent(t *testing.T) {
	// Отмена черновика не должна вырезать файл из уже отправленного сообщения.
	f := newAttachFixture(t)
	msgID := uuid.New()
	att := &domain.Attachment{ID: uuid.New(), UserID: f.userID, ChannelID: f.channelID, MessageID: &msgID}
	f.repo.On("GetByID", att.ID).Return(att, nil)

	err := f.uc.Delete(att.ID, f.userID)

	assert.ErrorIs(t, err, domain.ErrAttachmentAlreadyAttached)
	f.repo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestDeleteRemovesRowAndBothFiles(t *testing.T) {
	f := newAttachFixture(t)
	att := &domain.Attachment{
		ID: uuid.New(), UserID: f.userID, ChannelID: f.channelID,
		StorageKey: "attachments/c/a.png", ThumbKey: "attachments/c/a_thumb.jpg",
	}
	f.repo.On("GetByID", att.ID).Return(att, nil)
	f.repo.On("Delete", att.ID).Return(nil)
	f.storage.On("Delete", mock.Anything, "attachments/c/a.png").Return(nil)
	f.storage.On("Delete", mock.Anything, "attachments/c/a_thumb.jpg").Return(nil)

	require.NoError(t, f.uc.Delete(att.ID, f.userID))

	f.storage.AssertExpectations(t)
	f.repo.AssertExpectations(t)
}

func TestOpenThumbRejectsNonImageAttachment(t *testing.T) {
	// Подпись ссылки покрывает id и срок, но не путь: ссылку на /content можно
	// предъявить и на /thumb. Без этой проверки не-медиа файл (например HTML)
	// отдавался бы через /thumb в обход принудительного octet-stream.
	f := newAttachFixture(t)
	att := &domain.Attachment{
		ID: uuid.New(), Kind: domain.AttachmentKindFile, StorageKey: "attachments/c/evil.html",
	}
	f.repo.On("GetByID", att.ID).Return(att, nil)

	_, _, err := f.uc.OpenThumb(att.ID)

	assert.ErrorIs(t, err, domain.ErrAttachmentNotFound)
	f.storage.AssertNotCalled(t, "Open", mock.Anything, mock.Anything)
}

func TestOpenThumbFallsBackToOriginalForImageWithoutThumbnail(t *testing.T) {
	// Фолбэк на оригинал остаётся допустим для картинок без миниатюры.
	f := newAttachFixture(t)
	att := &domain.Attachment{
		ID: uuid.New(), Kind: domain.AttachmentKindImage, StorageKey: "attachments/c/a.png",
	}
	f.repo.On("GetByID", att.ID).Return(att, nil)
	f.storage.On("Open", mock.Anything, "attachments/c/a.png").Return(nopSeekCloser{bytes.NewReader(nil)}, nil)

	_, _, err := f.uc.OpenThumb(att.ID)

	require.NoError(t, err)
	f.storage.AssertExpectations(t)
}

// nopSeekCloser превращает bytes.Reader в io.ReadSeekCloser для тестов.
type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }
