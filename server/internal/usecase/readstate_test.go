package usecase_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type readFx struct {
	repo                      *MockReadStateRepository
	msgs                      *MockMessageRepository
	chans                     *MockChannelRepository
	serverID, channelID, user uuid.UUID
}

func newReadFx(bits domain.Permission) (*readFx, domain.ReadStateUseCase) {
	f := &readFx{
		repo: new(MockReadStateRepository), msgs: new(MockMessageRepository), chans: new(MockChannelRepository),
		serverID: uuid.New(), channelID: uuid.New(), user: uuid.New(),
	}
	f.chans.On("GetByID", f.channelID).Return(&domain.Channel{ID: f.channelID, ServerID: f.serverID}, nil)
	perms := permsWith(f.serverID, f.user, bits)
	return f, usecase.NewReadStateUseCase(f.repo, f.msgs, f.chans, perms)
}

func (f *readFx) userMsg(author uuid.UUID) *domain.Message {
	return &domain.Message{ID: uuid.New(), ChannelID: f.channelID, UserID: &author, Kind: "user", CreatedAt: time.Now().Truncate(time.Microsecond)}
}

func TestReadState_MarkRead_ForbiddenWithoutView(t *testing.T) {
	f, uc := newReadFx(0)
	_, err := uc.MarkRead(f.user, f.channelID, uuid.New())
	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.repo.AssertNotCalled(t, "Advance", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestReadState_MarkRead_MessageFromOtherChannel(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	other := &domain.Message{ID: uuid.New(), ChannelID: uuid.New(), Kind: "user"}
	f.msgs.On("GetByID", other.ID).Return(other, nil)

	_, err := uc.MarkRead(f.user, f.channelID, other.ID)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
	f.repo.AssertNotCalled(t, "Advance", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestReadState_MarkRead_Success(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	m := f.userMsg(uuid.New())
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	f.repo.On("Advance", f.user, f.channelID, m.CreatedAt, m.ID).Return(true, nil)
	f.repo.On("Cursor", f.user, f.channelID).Return(&domain.ReadCursor{At: m.CreatedAt, MessageID: &m.ID}, nil)
	f.repo.On("CountUnread", f.user, f.channelID).Return(3, nil)

	res, err := uc.MarkRead(f.user, f.channelID, m.ID)
	require.NoError(t, err)
	assert.True(t, res.Advanced)
	assert.Equal(t, 3, res.Count)
	assert.Equal(t, f.serverID, res.ServerID)
	require.NotNil(t, res.MessageID)
	assert.Equal(t, m.ID, *res.MessageID)
}

func TestReadState_OthersRead(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	f.repo.On("OthersMax", f.user, f.channelID).Return(nil, nil)
	cur, err := uc.OthersRead(f.user, f.channelID)
	require.NoError(t, err)
	assert.Nil(t, cur)
}

func TestReadState_Readers_AuthorSplitsLists(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	m := f.userMsg(f.user)
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	b, c := &domain.Reader{UserID: uuid.New(), HasRead: true}, &domain.Reader{UserID: uuid.New()}
	f.repo.On("Readers", f.serverID, f.channelID, m.CreatedAt, m.ID, f.user).Return([]*domain.Reader{b, c}, nil)

	res, err := uc.Readers(f.user, f.channelID, m.ID)
	require.NoError(t, err)
	assert.Equal(t, []*domain.Reader{b}, res.Read)
	assert.Equal(t, []*domain.Reader{c}, res.Unread)
}

func TestReadState_Readers_EmptyListsAreNotNil(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	m := f.userMsg(f.user)
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	f.repo.On("Readers", f.serverID, f.channelID, m.CreatedAt, m.ID, f.user).Return([]*domain.Reader{}, nil)

	res, err := uc.Readers(f.user, f.channelID, m.ID)
	require.NoError(t, err)
	assert.NotNil(t, res.Read)
	assert.NotNil(t, res.Unread)
}

func TestReadState_Readers_StrangerForbidden(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels)
	m := f.userMsg(uuid.New())
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	_, err := uc.Readers(f.user, f.channelID, m.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestReadState_Readers_AdminAllowed(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels | domain.PermAdministrator)
	author := uuid.New()
	m := f.userMsg(author)
	f.msgs.On("GetByID", m.ID).Return(m, nil)
	f.repo.On("Readers", f.serverID, f.channelID, m.CreatedAt, m.ID, author).Return([]*domain.Reader{}, nil)
	_, err := uc.Readers(f.user, f.channelID, m.ID)
	require.NoError(t, err)
}

func TestReadState_Readers_GuestAndCallForbidden(t *testing.T) {
	f, uc := newReadFx(domain.PermViewChannels | domain.PermAdministrator)
	guestID := uuid.New()
	guestMsg := &domain.Message{ID: uuid.New(), ChannelID: f.channelID, GuestID: &guestID, Kind: "user"}
	callMsg := &domain.Message{ID: uuid.New(), ChannelID: f.channelID, UserID: &f.user, Kind: "call"}
	f.msgs.On("GetByID", guestMsg.ID).Return(guestMsg, nil)
	f.msgs.On("GetByID", callMsg.ID).Return(callMsg, nil)

	_, err := uc.Readers(f.user, f.channelID, guestMsg.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = uc.Readers(f.user, f.channelID, callMsg.ID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestReadState_AuthorRead(t *testing.T) {
	f, uc := newReadFx(0)
	m := f.userMsg(f.user)
	f.repo.On("Advance", f.user, f.channelID, m.CreatedAt, m.ID).Return(true, nil)
	require.NoError(t, uc.AuthorRead(m))
	f.repo.AssertNumberOfCalls(t, "Advance", 1)

	guestID := uuid.New()
	require.NoError(t, uc.AuthorRead(&domain.Message{ID: uuid.New(), ChannelID: f.channelID, GuestID: &guestID, Kind: "user"}))
	f.repo.AssertNumberOfCalls(t, "Advance", 1)
}

func TestReadState_Activity(t *testing.T) {
	f, uc := newReadFx(0)
	members := []uuid.UUID{uuid.New(), uuid.New()}
	f.repo.On("ServerMemberIDs", f.serverID).Return(members, nil)

	m := f.userMsg(f.user)
	ev, audience, err := uc.Activity(m, domain.ChannelActivityCreate)
	require.NoError(t, err)
	require.NotNil(t, ev)
	assert.Equal(t, domain.ChannelActivity{
		Op: "create", ServerID: f.serverID, ChannelID: f.channelID, MessageID: m.ID,
		CreatedAt: m.CreatedAt, AuthorUserID: m.UserID,
	}, *ev)
	assert.Equal(t, members, audience)

	ev, audience, err = uc.Activity(&domain.Message{ID: uuid.New(), ChannelID: f.channelID, Kind: "call"}, domain.ChannelActivityCreate)
	require.NoError(t, err)
	assert.Nil(t, ev)
	assert.Nil(t, audience)
}
