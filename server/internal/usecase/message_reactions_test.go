package usecase_test

import (
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

func TestGetMessages_FillsReactions(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()
	m1, m2 := &domain.Message{ID: uuid.New(), ChannelID: channelID}, &domain.Message{ID: uuid.New(), ChannelID: channelID}

	msgRepo, chRepo, attach, reactions := new(MockMessageRepository), new(MockChannelRepository), new(MockAttachmentRepository), new(MockReactionRepository)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return([]*domain.Message{m1, m2}, nil)
	attach.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)
	snap := []domain.Reaction{{Key: "👍", Emoji: "👍", Count: 1, UserIDs: []uuid.UUID{userID}}}
	reactions.On("ListByMessageIDs", []uuid.UUID{m1.ID, m2.ID}).Return(map[uuid.UUID][]domain.Reaction{m1.ID: snap}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{},
		permsWith(serverID, userID, domain.PermViewChannels), attach, reactions, new(MockStorage))
	got, err := uc.GetMessages(channelID, userID, 0, 0)
	require.NoError(t, err)
	assert.Equal(t, snap, got[0].Reactions)
	assert.Nil(t, got[1].Reactions)
}

func TestGetMessages_ReactionFailureKeepsMessages(t *testing.T) {
	channelID, serverID, userID := uuid.New(), uuid.New(), uuid.New()
	m1 := &domain.Message{ID: uuid.New(), ChannelID: channelID}

	msgRepo, chRepo, attach, reactions := new(MockMessageRepository), new(MockChannelRepository), new(MockAttachmentRepository), new(MockReactionRepository)
	chRepo.On("GetByID", channelID).Return(&domain.Channel{ID: channelID, ServerID: serverID}, nil)
	msgRepo.On("GetByChannelID", channelID, 50, 0).Return([]*domain.Message{m1}, nil)
	attach.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)
	reactions.On("ListByMessageIDs", mock.Anything).Return(nil, errors.New("db down"))

	uc := usecase.NewMessageUseCase(msgRepo, chRepo, new(MockServerRepository), &MockStickerRepository{},
		permsWith(serverID, userID, domain.PermViewChannels), attach, reactions, new(MockStorage))
	got, err := uc.GetMessages(channelID, userID, 0, 0)
	require.NoError(t, err)
	require.Len(t, got, 1)
}

func TestListGuestMessages_ReactionsWithoutUserIDs(t *testing.T) {
	channelID := uuid.New()
	admitted := time.Now().Add(-time.Hour)
	guest := &domain.GuestContext{Guest: domain.CallGuest{ID: uuid.New(), ChannelID: channelID, Status: domain.GuestStatusAdmitted, AdmittedAt: &admitted}}
	gm := &domain.GuestChatMessage{ID: uuid.New(), Content: "hi"}

	msgRepo, attach, reactions := new(MockMessageRepository), new(MockAttachmentRepository), new(MockReactionRepository)
	msgRepo.On("ListForGuest", channelID, admitted, (*domain.Message)(nil), 50).Return([]*domain.GuestChatMessage{gm}, nil)
	attach.On("ListByMessageIDs", mock.Anything).Return(map[uuid.UUID][]*domain.Attachment{}, nil)
	reactions.On("ListByMessageIDs", []uuid.UUID{gm.ID}).Return(map[uuid.UUID][]domain.Reaction{
		gm.ID: {{Key: "👍", Emoji: "👍", Count: 1, UserIDs: []uuid.UUID{uuid.New()}}},
	}, nil)

	uc := usecase.NewMessageUseCase(msgRepo, new(MockChannelRepository), new(MockServerRepository), &MockStickerRepository{},
		new(MockPermissionUseCase), attach, reactions, new(MockStorage))
	list, err := uc.ListGuestMessages(guest, nil, 0)
	require.NoError(t, err)
	require.Len(t, list[0].Reactions, 1)
	assert.Equal(t, 1, list[0].Reactions[0].Count)
	assert.Nil(t, list[0].Reactions[0].UserIDs)
}
