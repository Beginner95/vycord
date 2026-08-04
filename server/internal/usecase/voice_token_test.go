package usecase_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/authtoken"
)

type MockChannelAccessChecker struct{ mock.Mock }

func (m *MockChannelAccessChecker) CheckChannelAccess(channelID, userID uuid.UUID) (*domain.Channel, error) {
	args := m.Called(channelID, userID)
	ch, _ := args.Get(0).(*domain.Channel)
	return ch, args.Error(1)
}
func (m *MockChannelAccessChecker) GetChannelAudience(channelID uuid.UUID) ([]uuid.UUID, error) {
	args := m.Called(channelID)
	ids, _ := args.Get(0).([]uuid.UUID)
	return ids, args.Error(1)
}

func TestIssueToken_VoiceChannelAccessGranted_ReturnsValidRoomToken(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	ch := &domain.Channel{ID: channelID, Type: domain.ChannelTypeVoice}

	access := new(MockChannelAccessChecker)
	access.On("CheckChannelAccess", channelID, userID).Return(ch, nil)

	uc := usecase.NewVoiceTokenUseCase(access, "test-secret")
	tok, err := uc.IssueToken(channelID, userID)

	require.NoError(t, err)
	gotUser, gotRoom, err := authtoken.ValidateRoomToken("test-secret", tok)
	require.NoError(t, err)
	assert.Equal(t, userID, gotUser)
	assert.Equal(t, channelID, gotRoom)
}

func TestIssueToken_AccessDenied_PropagatesError(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()

	access := new(MockChannelAccessChecker)
	access.On("CheckChannelAccess", channelID, userID).Return(nil, domain.ErrChannelForbidden)

	uc := usecase.NewVoiceTokenUseCase(access, "test-secret")
	_, err := uc.IssueToken(channelID, userID)

	assert.ErrorIs(t, err, domain.ErrChannelForbidden)
}

func TestIssueToken_TextChannel_Rejected(t *testing.T) {
	channelID := uuid.New()
	userID := uuid.New()
	ch := &domain.Channel{ID: channelID, Type: domain.ChannelTypeText}

	access := new(MockChannelAccessChecker)
	access.On("CheckChannelAccess", channelID, userID).Return(ch, nil)

	uc := usecase.NewVoiceTokenUseCase(access, "test-secret")
	_, err := uc.IssueToken(channelID, userID)

	assert.ErrorIs(t, err, domain.ErrChannelNotVoice)
}
