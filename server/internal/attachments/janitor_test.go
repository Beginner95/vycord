package attachments_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/attachments"
	"github.com/vycord/server/internal/domain"
)

type MockRepo struct{ mock.Mock }

func (m *MockRepo) Create(a *domain.Attachment) error { return m.Called(a).Error(0) }
func (m *MockRepo) GetByID(id uuid.UUID) (*domain.Attachment, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Attachment), args.Error(1)
}
func (m *MockRepo) ListByMessageIDs(ids []uuid.UUID) (map[uuid.UUID][]*domain.Attachment, error) {
	args := m.Called(ids)
	return args.Get(0).(map[uuid.UUID][]*domain.Attachment), args.Error(1)
}
func (m *MockRepo) AttachToMessage(messageID, userID, channelID uuid.UUID, ids []uuid.UUID) error {
	return m.Called(messageID, userID, channelID, ids).Error(0)
}
func (m *MockRepo) Delete(id uuid.UUID) error { return m.Called(id).Error(0) }
func (m *MockRepo) DeleteIfUnattached(id uuid.UUID) (bool, error) {
	args := m.Called(id)
	return args.Bool(0), args.Error(1)
}
func (m *MockRepo) ListSweepable(now, orphanBefore time.Time, limit int) ([]*domain.Attachment, error) {
	args := m.Called(now, orphanBefore, limit)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Attachment), args.Error(1)
}
func (m *MockRepo) TotalBytesByUser(userID uuid.UUID) (int64, error) {
	args := m.Called(userID)
	return args.Get(0).(int64), args.Error(1)
}

type MockStore struct{ mock.Mock }

func (m *MockStore) Save(ctx context.Context, key string, r io.Reader, ct string) (string, error) {
	args := m.Called(ctx, key, r, ct)
	return args.String(0), args.Error(1)
}
func (m *MockStore) Delete(ctx context.Context, key string) error {
	return m.Called(ctx, key).Error(0)
}
func (m *MockStore) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	args := m.Called(ctx, key)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(io.ReadSeekCloser), args.Error(1)
}

func TestSweepDeletesFilesAndRows(t *testing.T) {
	att := &domain.Attachment{ID: uuid.New(), StorageKey: "a/b.png", ThumbKey: "a/b_thumb.jpg"}
	repo := new(MockRepo)
	store := new(MockStore)
	repo.On("ListSweepable", mock.Anything, mock.Anything, mock.Anything).Return([]*domain.Attachment{att}, nil)
	store.On("Delete", mock.Anything, "a/b.png").Return(nil)
	store.On("Delete", mock.Anything, "a/b_thumb.jpg").Return(nil)
	repo.On("DeleteIfUnattached", att.ID).Return(true, nil)

	n, err := attachments.NewJanitor(repo, store, slog.Default()).Sweep(context.Background(), time.Now())

	require.NoError(t, err)
	assert.Equal(t, 1, n)
	store.AssertExpectations(t)
	repo.AssertExpectations(t)
}

func TestSweepAsksForOrphansOlderThanConfiguredAge(t *testing.T) {
	// Свежий черновик удалять нельзя: пользователь может дописывать текст.
	repo := new(MockRepo)
	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	repo.On("ListSweepable", now, now.Add(-24*time.Hour), 500).Return([]*domain.Attachment{}, nil)

	j := attachments.NewJanitor(repo, new(MockStore), slog.Default())
	_, err := j.Sweep(context.Background(), now)

	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func TestSweepContinuesWhenFileDeletionFails(t *testing.T) {
	// Файла может уже не быть на диске — строку всё равно надо убрать, иначе
	// уборщик будет спотыкаться о неё вечно.
	att := &domain.Attachment{ID: uuid.New(), StorageKey: "a/b.png"}
	repo := new(MockRepo)
	store := new(MockStore)
	repo.On("ListSweepable", mock.Anything, mock.Anything, mock.Anything).Return([]*domain.Attachment{att}, nil)
	store.On("Delete", mock.Anything, "a/b.png").Return(errors.New("disk error"))
	repo.On("DeleteIfUnattached", att.ID).Return(true, nil)

	n, err := attachments.NewJanitor(repo, store, slog.Default()).Sweep(context.Background(), time.Now())

	require.NoError(t, err)
	assert.Equal(t, 1, n)
	repo.AssertCalled(t, "DeleteIfUnattached", att.ID)
}

func TestSweepKeepsOrphanAttachedWhileSweeping(t *testing.T) {
	// Гонка: между ListSweepable и удалением черновик старше суток успели
	// приложить к сообщению. Безусловное удаление вырезало бы файл из уже
	// отправленного сообщения, поэтому условие живёт в самом DELETE.
	att := &domain.Attachment{ID: uuid.New(), StorageKey: "a/b.png", ThumbKey: "a/b_thumb.jpg"}
	repo := new(MockRepo)
	store := new(MockStore)
	repo.On("ListSweepable", mock.Anything, mock.Anything, mock.Anything).Return([]*domain.Attachment{att}, nil)
	repo.On("DeleteIfUnattached", att.ID).Return(false, nil)

	n, err := attachments.NewJanitor(repo, store, slog.Default()).Sweep(context.Background(), time.Now())

	require.NoError(t, err)
	assert.Equal(t, 0, n)
	store.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything)
}

func TestSweepDeletesExpiredAttachedAttachment(t *testing.T) {
	// Вторая ветка уборки: срок хранения истёк. Привязанность тут роли не
	// играет — удаляем безусловно, но файл всё равно после строки.
	messageID := uuid.New()
	att := &domain.Attachment{ID: uuid.New(), MessageID: &messageID, StorageKey: "a/old.png"}
	repo := new(MockRepo)
	store := new(MockStore)
	repo.On("ListSweepable", mock.Anything, mock.Anything, mock.Anything).Return([]*domain.Attachment{att}, nil)
	repo.On("Delete", att.ID).Return(nil)
	store.On("Delete", mock.Anything, "a/old.png").Return(nil)

	n, err := attachments.NewJanitor(repo, store, slog.Default()).Sweep(context.Background(), time.Now())

	require.NoError(t, err)
	assert.Equal(t, 1, n)
	repo.AssertNotCalled(t, "DeleteIfUnattached", mock.Anything)
	store.AssertExpectations(t)
}

func TestSweepDoesNotTouchFileWhenRowDeleteFails(t *testing.T) {
	// Обратный порядок оставил бы строку без файла — в ленте битая картинка.
	att := &domain.Attachment{ID: uuid.New(), StorageKey: "a/b.png"}
	repo := new(MockRepo)
	store := new(MockStore)
	repo.On("ListSweepable", mock.Anything, mock.Anything, mock.Anything).Return([]*domain.Attachment{att}, nil)
	repo.On("DeleteIfUnattached", att.ID).Return(false, errors.New("db down"))

	n, err := attachments.NewJanitor(repo, store, slog.Default()).Sweep(context.Background(), time.Now())

	require.NoError(t, err)
	assert.Equal(t, 0, n)
	store.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything)
}

func TestSweepSkipsThumbDeletionWhenThereIsNone(t *testing.T) {
	att := &domain.Attachment{ID: uuid.New(), StorageKey: "a/b.pdf"}
	repo := new(MockRepo)
	store := new(MockStore)
	repo.On("ListSweepable", mock.Anything, mock.Anything, mock.Anything).Return([]*domain.Attachment{att}, nil)
	store.On("Delete", mock.Anything, "a/b.pdf").Return(nil)
	repo.On("DeleteIfUnattached", att.ID).Return(true, nil)

	_, err := attachments.NewJanitor(repo, store, slog.Default()).Sweep(context.Background(), time.Now())

	require.NoError(t, err)
	store.AssertNumberOfCalls(t, "Delete", 1)
}

func TestSweepReturnsZeroWhenNothingToDo(t *testing.T) {
	repo := new(MockRepo)
	repo.On("ListSweepable", mock.Anything, mock.Anything, mock.Anything).Return([]*domain.Attachment{}, nil)

	n, err := attachments.NewJanitor(repo, new(MockStore), slog.Default()).Sweep(context.Background(), time.Now())

	require.NoError(t, err)
	assert.Equal(t, 0, n)
}
