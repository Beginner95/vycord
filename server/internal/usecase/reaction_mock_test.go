package usecase_test

import (
	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
)

type MockReactionRepository struct{ mock.Mock }

func (m *MockReactionRepository) Add(messageID, userID uuid.UUID, key domain.ReactionKey, maxDistinct int) ([]domain.Reaction, error) {
	args := m.Called(messageID, userID, key, maxDistinct)
	rs, _ := args.Get(0).([]domain.Reaction)
	return rs, args.Error(1)
}
func (m *MockReactionRepository) Remove(messageID, userID uuid.UUID, key domain.ReactionKey) ([]domain.Reaction, error) {
	args := m.Called(messageID, userID, key)
	rs, _ := args.Get(0).([]domain.Reaction)
	return rs, args.Error(1)
}
func (m *MockReactionRepository) ListByMessageIDs(ids []uuid.UUID) (map[uuid.UUID][]domain.Reaction, error) {
	args := m.Called(ids)
	byMsg, _ := args.Get(0).(map[uuid.UUID][]domain.Reaction)
	return byMsg, args.Error(1)
}
