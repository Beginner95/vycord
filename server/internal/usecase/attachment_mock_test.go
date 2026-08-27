package usecase_test

import (
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"
	"github.com/vycord/server/internal/domain"
)

type MockAttachmentRepository struct{ mock.Mock }

func (m *MockAttachmentRepository) Create(a *domain.Attachment) error {
	return m.Called(a).Error(0)
}

func (m *MockAttachmentRepository) GetByID(id uuid.UUID) (*domain.Attachment, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Attachment), args.Error(1)
}

func (m *MockAttachmentRepository) ListByMessageIDs(ids []uuid.UUID) (map[uuid.UUID][]*domain.Attachment, error) {
	args := m.Called(ids)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(map[uuid.UUID][]*domain.Attachment), args.Error(1)
}

func (m *MockAttachmentRepository) AttachToMessage(messageID, userID, channelID uuid.UUID, ids []uuid.UUID) error {
	return m.Called(messageID, userID, channelID, ids).Error(0)
}

func (m *MockAttachmentRepository) Delete(id uuid.UUID) error {
	return m.Called(id).Error(0)
}

func (m *MockAttachmentRepository) ListSweepable(now, orphanBefore time.Time, limit int) ([]*domain.Attachment, error) {
	args := m.Called(now, orphanBefore, limit)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.Attachment), args.Error(1)
}

func (m *MockAttachmentRepository) TotalBytesByUser(userID uuid.UUID) (int64, error) {
	args := m.Called(userID)
	return args.Get(0).(int64), args.Error(1)
}
