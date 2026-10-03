package usecase_test

import (
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
)

type MockReadStateRepository struct{ mock.Mock }

func (m *MockReadStateRepository) ListUnread(userID uuid.UUID) ([]*domain.ChannelUnread, error) {
	args := m.Called(userID)
	list, _ := args.Get(0).([]*domain.ChannelUnread)
	return list, args.Error(1)
}
func (m *MockReadStateRepository) CountUnread(userID, channelID uuid.UUID) (int, error) {
	args := m.Called(userID, channelID)
	return args.Int(0), args.Error(1)
}
func (m *MockReadStateRepository) Cursor(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	args := m.Called(userID, channelID)
	cur, _ := args.Get(0).(*domain.ReadCursor)
	return cur, args.Error(1)
}
func (m *MockReadStateRepository) Advance(userID, channelID uuid.UUID, at time.Time, messageID uuid.UUID) (bool, error) {
	args := m.Called(userID, channelID, at, messageID)
	return args.Bool(0), args.Error(1)
}
func (m *MockReadStateRepository) OthersMax(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	args := m.Called(userID, channelID)
	cur, _ := args.Get(0).(*domain.ReadCursor)
	return cur, args.Error(1)
}
func (m *MockReadStateRepository) Readers(serverID, channelID uuid.UUID, at time.Time, messageID, authorID uuid.UUID) ([]*domain.Reader, error) {
	args := m.Called(serverID, channelID, at, messageID, authorID)
	list, _ := args.Get(0).([]*domain.Reader)
	return list, args.Error(1)
}
func (m *MockReadStateRepository) ServerMemberIDs(serverID uuid.UUID) ([]uuid.UUID, error) {
	args := m.Called(serverID)
	ids, _ := args.Get(0).([]uuid.UUID)
	return ids, args.Error(1)
}
