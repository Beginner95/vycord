package usecase_test

import (
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"
	"github.com/vycord/server/internal/domain"
)

type MockFriendRepository struct{ mock.Mock }

func (m *MockFriendRepository) GetFriends(userID uuid.UUID) ([]*domain.FriendProfile, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.FriendProfile), args.Error(1)
}

func (m *MockFriendRepository) GetPending(userID uuid.UUID) ([]*domain.FriendRequest, []*domain.FriendRequest, error) {
	args := m.Called(userID)
	var in, out []*domain.FriendRequest
	if args.Get(0) != nil {
		in = args.Get(0).([]*domain.FriendRequest)
	}
	if args.Get(1) != nil {
		out = args.Get(1).([]*domain.FriendRequest)
	}
	return in, out, args.Error(2)
}

func (m *MockFriendRepository) GetByPair(a, b uuid.UUID) (*domain.Friendship, error) {
	args := m.Called(a, b)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Friendship), args.Error(1)
}

func (m *MockFriendRepository) GetByID(id uuid.UUID) (*domain.Friendship, error) {
	args := m.Called(id)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Friendship), args.Error(1)
}

func (m *MockFriendRepository) Create(f *domain.Friendship) error {
	return m.Called(f).Error(0)
}

func (m *MockFriendRepository) Accept(id, addresseeID uuid.UUID, at time.Time) error {
	return m.Called(id, addresseeID, at).Error(0)
}

func (m *MockFriendRepository) Delete(id, actorID uuid.UUID) error {
	return m.Called(id, actorID).Error(0)
}

func (m *MockFriendRepository) DeleteByPair(a, b uuid.UUID) error {
	return m.Called(a, b).Error(0)
}

func (m *MockFriendRepository) IsFriend(a, b uuid.UUID) (bool, error) {
	args := m.Called(a, b)
	return args.Bool(0), args.Error(1)
}

type MockBlockRepository struct{ mock.Mock }

func (m *MockBlockRepository) List(blockerID uuid.UUID) ([]*domain.UserBrief, error) {
	args := m.Called(blockerID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.UserBrief), args.Error(1)
}

func (m *MockBlockRepository) Block(blockerID, blockedID uuid.UUID) error {
	return m.Called(blockerID, blockedID).Error(0)
}

func (m *MockBlockRepository) Unblock(blockerID, blockedID uuid.UUID) error {
	return m.Called(blockerID, blockedID).Error(0)
}

func (m *MockBlockRepository) IsBlockedEither(a, b uuid.UUID) (bool, error) {
	args := m.Called(a, b)
	return args.Bool(0), args.Error(1)
}
