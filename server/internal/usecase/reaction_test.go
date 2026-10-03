package usecase_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type reactionEnv struct {
	uc                                 domain.ReactionUseCase
	repo                               *MockReactionRepository
	msgRepo                            *MockMessageRepository
	stickers                           *MockStickerRepository
	channelID, serverID, userID, msgID uuid.UUID
}

func newReactionEnv(t *testing.T, bits domain.Permission, kind string) *reactionEnv {
	t.Helper()
	e := &reactionEnv{
		repo: new(MockReactionRepository), msgRepo: new(MockMessageRepository), stickers: new(MockStickerRepository),
		channelID: uuid.New(), serverID: uuid.New(), userID: uuid.New(), msgID: uuid.New(),
	}
	chRepo := new(MockChannelRepository)
	chRepo.On("GetByID", e.channelID).Return(&domain.Channel{ID: e.channelID, ServerID: e.serverID}, nil)
	e.msgRepo.On("GetByID", e.msgID).Return(&domain.Message{ID: e.msgID, ChannelID: e.channelID, Kind: kind}, nil)
	e.uc = usecase.NewReactionUseCase(e.repo, e.msgRepo, chRepo, e.stickers, permsWith(e.serverID, e.userID, bits))
	return e
}

func TestReactionAdd_Emoji(t *testing.T) {
	e := newReactionEnv(t, domain.PermSendMessages, "user")
	snap := []domain.Reaction{{Key: "👍", Emoji: "👍", Count: 1, UserIDs: []uuid.UUID{e.userID}}}
	e.repo.On("Add", e.msgID, e.userID, domain.ReactionKey{Emoji: "👍"}, domain.MaxDistinctReactions).Return(snap, nil)

	got, err := e.uc.Add(e.userID, e.channelID, e.msgID, "👍")
	require.NoError(t, err)
	assert.Equal(t, snap, got)
}

func TestReactionAdd_RequiresSendMessages(t *testing.T) {
	e := newReactionEnv(t, domain.PermViewChannels, "user")
	_, err := e.uc.Add(e.userID, e.channelID, e.msgID, "👍")
	assert.ErrorIs(t, err, domain.ErrForbidden)
	e.repo.AssertNotCalled(t, "Add", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestReactionAdd_InvalidKeyBeforeAnyLookup(t *testing.T) {
	e := newReactionEnv(t, domain.PermSendMessages, "user")
	_, err := e.uc.Add(e.userID, e.channelID, e.msgID, "ab")
	assert.ErrorIs(t, err, domain.ErrReactionInvalid)
	e.msgRepo.AssertNotCalled(t, "GetByID", mock.Anything)
}

func TestReactionAdd_CallPlacardNotAllowed(t *testing.T) {
	e := newReactionEnv(t, domain.PermSendMessages, "call")
	_, err := e.uc.Add(e.userID, e.channelID, e.msgID, "👍")
	assert.ErrorIs(t, err, domain.ErrReactionNotAllowed)
}

func TestReactionAdd_MessageFromOtherChannel(t *testing.T) {
	e := newReactionEnv(t, domain.PermSendMessages, "user")
	other := uuid.New()
	e.msgRepo.ExpectedCalls = nil
	e.msgRepo.On("GetByID", e.msgID).Return(&domain.Message{ID: e.msgID, ChannelID: other, Kind: "user"}, nil)
	_, err := e.uc.Add(e.userID, e.channelID, e.msgID, "👍")
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
}

func TestReactionAdd_StickerOfThisServer(t *testing.T) {
	e := newReactionEnv(t, domain.PermSendMessages, "user")
	sid := uuid.New()
	e.stickers.On("GetByID", sid).Return(&domain.Sticker{ID: sid, ServerID: e.serverID}, nil)
	e.repo.On("Add", e.msgID, e.userID, domain.ReactionKey{StickerID: &sid}, domain.MaxDistinctReactions).Return([]domain.Reaction{}, nil)

	_, err := e.uc.Add(e.userID, e.channelID, e.msgID, "sticker:"+sid.String())
	require.NoError(t, err)
}

func TestReactionAdd_StickerOfOtherServer(t *testing.T) {
	e := newReactionEnv(t, domain.PermSendMessages, "user")
	sid := uuid.New()
	e.stickers.On("GetByID", sid).Return(&domain.Sticker{ID: sid, ServerID: uuid.New()}, nil)
	_, err := e.uc.Add(e.userID, e.channelID, e.msgID, "sticker:"+sid.String())
	assert.ErrorIs(t, err, domain.ErrStickerNotFound)
	e.repo.AssertNotCalled(t, "Add", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestReactionAdd_LimitFromRepo(t *testing.T) {
	e := newReactionEnv(t, domain.PermSendMessages, "user")
	e.repo.On("Add", e.msgID, e.userID, domain.ReactionKey{Emoji: "🔥"}, domain.MaxDistinctReactions).Return(nil, domain.ErrReactionLimitReached)
	_, err := e.uc.Add(e.userID, e.channelID, e.msgID, "🔥")
	assert.ErrorIs(t, err, domain.ErrReactionLimitReached)
}

func TestReactionRemove(t *testing.T) {
	e := newReactionEnv(t, domain.PermSendMessages, "user")
	e.repo.On("Remove", e.msgID, e.userID, domain.ReactionKey{Emoji: "👍"}).Return([]domain.Reaction{}, nil)
	got, err := e.uc.Remove(e.userID, e.channelID, e.msgID, "👍")
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestReactionRemove_RequiresSendMessages(t *testing.T) {
	e := newReactionEnv(t, 0, "user")
	_, err := e.uc.Remove(e.userID, e.channelID, e.msgID, "👍")
	assert.ErrorIs(t, err, domain.ErrForbidden)
}
