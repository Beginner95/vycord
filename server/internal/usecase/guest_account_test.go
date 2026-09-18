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
	"github.com/vycord/server/pkg/authtoken"
)

const guestTestSecret = "guest-usecase-secret"

type guestUCFixture struct {
	repo     *MockGuestRepository
	servers  *MockServerRepository
	access   *MockChannelAccessChecker
	perms    *MockPermissionUseCase
	presence *fakePresence
	events   *recordingEvents
	turn     *stubTURN
	uc       *usecase.GuestUseCaseForTest
	now      time.Time

	serverID, channelID, callID, ownerID, memberID, strangerID uuid.UUID
}

func newGuestUCFixture(t *testing.T) *guestUCFixture {
	t.Helper()
	f := &guestUCFixture{
		repo: new(MockGuestRepository), servers: new(MockServerRepository),
		access: new(MockChannelAccessChecker), perms: new(MockPermissionUseCase),
		presence: newFakePresence(), events: &recordingEvents{},
		turn:     &stubTURN{creds: &domain.TURNCredentials{Username: "u", TTLSeconds: 3600}},
		now:      time.Now().Truncate(time.Second),
		serverID: uuid.New(), channelID: uuid.New(), callID: uuid.New(),
		ownerID: uuid.New(), memberID: uuid.New(), strangerID: uuid.New(),
	}
	f.uc = usecase.NewGuestUseCaseForTest(usecase.GuestUseCaseDeps{
		Repo: f.repo, Servers: f.servers, Access: f.access, Perms: f.perms,
		Presence: f.presence, TURN: f.turn, JWTSecret: guestTestSecret,
		Now: func() time.Time { return f.now },
	})
	f.uc.SetEvents(f.events)
	return f
}

func (f *guestUCFixture) grantAccess(users ...uuid.UUID) {
	for _, u := range users {
		f.access.On("CheckChannelAccess", f.channelID, u).
			Return(&domain.Channel{ID: f.channelID, ServerID: f.serverID}, nil)
	}
}

func (f *guestUCFixture) grantPerms(userID uuid.UUID, bits domain.Permission) {
	f.perms.On("Resolve", f.serverID, userID).Return(domain.PermissionSet{Bits: bits}, nil)
}

func (f *guestUCFixture) guestCtx(status domain.GuestStatus, linkCreator *uuid.UUID) *domain.GuestContext {
	return &domain.GuestContext{
		Guest: domain.CallGuest{
			ID: uuid.New(), LinkID: uuid.New(), ChannelID: f.channelID, CallMessageID: f.callID,
			DisplayName: "Гость", Status: status, CreatedAt: f.now,
		},
		ServerID: f.serverID, LinkCreatedBy: linkCreator, GuestLinksEnabled: true,
	}
}

func TestGuestUC_CreateLink(t *testing.T) {
	f := newGuestUCFixture(t)
	f.grantAccess(f.memberID)
	f.servers.On("GetByID", f.serverID).Return(&domain.Server{ID: f.serverID, GuestLinksEnabled: true}, nil)
	f.presence.put(f.channelID, f.memberID)
	f.repo.On("OpenCallMessageID", f.channelID).Return(f.callID, nil)

	var stored *domain.GuestLink
	var storedHash []byte
	f.repo.On("CreateLink", mock.AnythingOfType("*domain.GuestLink"), mock.Anything).
		Run(func(args mock.Arguments) {
			stored = args.Get(0).(*domain.GuestLink)
			storedHash = args.Get(1).([]byte)
		}).Return(nil)

	created, err := f.uc.CreateLink(f.channelID, f.memberID)
	require.NoError(t, err)

	assert.NotEmpty(t, created.Secret)
	assert.Equal(t, authtoken.HashOpaqueSecret(created.Secret), storedHash, "only the hash reaches the database")
	assert.Equal(t, f.callID, stored.CallMessageID)
	require.NotNil(t, stored.CreatedBy)
	assert.Equal(t, f.memberID, *stored.CreatedBy)
	assert.True(t, stored.ExpiresAt.Equal(f.now.Add(domain.GuestLinkTTL)))
	assert.Equal(t, stored.ID, created.ID)
	assert.Equal(t, []uuid.UUID{f.channelID}, f.events.linksChanged)
}

func TestGuestUC_CreateLinkRefusals(t *testing.T) {
	t.Run("server switch off", func(t *testing.T) {
		f := newGuestUCFixture(t)
		f.grantAccess(f.memberID)
		f.servers.On("GetByID", f.serverID).Return(&domain.Server{ID: f.serverID}, nil)
		f.presence.put(f.channelID, f.memberID)

		_, err := f.uc.CreateLink(f.channelID, f.memberID)
		assert.ErrorIs(t, err, domain.ErrGuestLinksDisabled)
		f.repo.AssertNotCalled(t, "CreateLink", mock.Anything, mock.Anything)
	})

	// Н15
	t.Run("not in the call", func(t *testing.T) {
		f := newGuestUCFixture(t)
		f.grantAccess(f.memberID)
		f.servers.On("GetByID", f.serverID).Return(&domain.Server{ID: f.serverID, GuestLinksEnabled: true}, nil)

		_, err := f.uc.CreateLink(f.channelID, f.memberID)
		assert.ErrorIs(t, err, domain.ErrNotInCall)
	})

	t.Run("no channel access", func(t *testing.T) {
		f := newGuestUCFixture(t)
		f.access.On("CheckChannelAccess", f.channelID, f.strangerID).Return(nil, domain.ErrChannelForbidden)

		_, err := f.uc.CreateLink(f.channelID, f.strangerID)
		assert.ErrorIs(t, err, domain.ErrChannelForbidden)
		f.servers.AssertNotCalled(t, "GetByID", mock.Anything)
	})

	t.Run("no active call", func(t *testing.T) {
		f := newGuestUCFixture(t)
		f.grantAccess(f.memberID)
		f.servers.On("GetByID", f.serverID).Return(&domain.Server{ID: f.serverID, GuestLinksEnabled: true}, nil)
		f.presence.put(f.channelID, f.memberID)
		f.repo.On("OpenCallMessageID", f.channelID).Return(uuid.Nil, domain.ErrCallNotActive)

		_, err := f.uc.CreateLink(f.channelID, f.memberID)
		assert.ErrorIs(t, err, domain.ErrCallNotActive)
	})
}

func TestGuestUC_ListCallGuests(t *testing.T) {
	f := newGuestUCFixture(t)
	f.grantAccess(f.memberID)
	f.presence.put(f.channelID, f.memberID)
	f.repo.On("OpenCallMessageID", f.channelID).Return(f.callID, nil)
	state := &domain.GuestCallState{Links: []*domain.GuestLink{{ID: uuid.New()}}, Guests: []*domain.CallGuest{}}
	f.repo.On("ListCallState", f.callID).Return(state, nil)

	got, err := f.uc.ListCallGuests(f.channelID, f.memberID)
	require.NoError(t, err)
	assert.Equal(t, state, got)

	f.access.On("CheckChannelAccess", f.channelID, f.strangerID).Return(nil, domain.ErrChannelForbidden)
	_, err = f.uc.ListCallGuests(f.channelID, f.strangerID)
	assert.ErrorIs(t, err, domain.ErrChannelForbidden)
}

func TestGuestUC_ListCallGuestsWithoutCallIsEmpty(t *testing.T) {
	f := newGuestUCFixture(t)
	f.grantAccess(f.memberID)
	f.presence.put(f.channelID, f.memberID)
	f.repo.On("OpenCallMessageID", f.channelID).Return(uuid.Nil, domain.ErrCallNotActive)

	state, err := f.uc.ListCallGuests(f.channelID, f.memberID)
	require.NoError(t, err)
	assert.Empty(t, state.Links)
	assert.Empty(t, state.Guests)
}

// Н16
func TestGuestUC_RevokeLinkModeration(t *testing.T) {
	newTarget := func(f *guestUCFixture, creator uuid.UUID) *domain.GuestLinkTarget {
		return &domain.GuestLinkTarget{
			Link:     domain.GuestLink{ID: uuid.New(), ChannelID: f.channelID, CallMessageID: f.callID, CreatedBy: &creator, ExpiresAt: f.now.Add(time.Hour)},
			ServerID: f.serverID, GuestLinksEnabled: true,
		}
	}

	t.Run("creator may revoke", func(t *testing.T) {
		f := newGuestUCFixture(t)
		target := newTarget(f, f.memberID)
		f.grantAccess(f.memberID)
		f.repo.On("GetLinkTargetByID", target.Link.ID).Return(target, nil)
		ended := []*domain.CallGuest{{ID: uuid.New(), ChannelID: f.channelID, Status: domain.GuestStatusRevoked}}
		f.repo.On("RevokeLink", target.Link.ID, &f.memberID, domain.GuestRevokeManual, f.now).Return(ended, nil)

		require.NoError(t, f.uc.RevokeLink(target.Link.ID, f.memberID))
		assert.Equal(t, []uuid.UUID{ended[0].ID}, f.events.endedIDs())
	})

	t.Run("administrator may revoke someone else's link", func(t *testing.T) {
		f := newGuestUCFixture(t)
		target := newTarget(f, f.memberID)
		f.grantAccess(f.ownerID)
		f.grantPerms(f.ownerID, domain.PermAdministrator)
		f.repo.On("GetLinkTargetByID", target.Link.ID).Return(target, nil)
		f.repo.On("RevokeLink", target.Link.ID, &f.ownerID, domain.GuestRevokeManual, f.now).Return(nil, nil)

		require.NoError(t, f.uc.RevokeLink(target.Link.ID, f.ownerID))
	})

	t.Run("plain participant is refused while a moderator is in the call", func(t *testing.T) {
		f := newGuestUCFixture(t)
		target := newTarget(f, f.memberID)
		f.grantAccess(f.strangerID)
		f.grantPerms(f.strangerID, 0)
		f.grantPerms(f.memberID, 0)
		f.presence.put(f.channelID, f.strangerID, f.memberID) // the link's creator is present
		f.repo.On("GetLinkTargetByID", target.Link.ID).Return(target, nil)

		err := f.uc.RevokeLink(target.Link.ID, f.strangerID)
		assert.ErrorIs(t, err, domain.ErrForbidden)
		f.repo.AssertNotCalled(t, "RevokeLink", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("fallback: no moderator in the call", func(t *testing.T) {
		f := newGuestUCFixture(t)
		target := newTarget(f, f.memberID)
		f.grantAccess(f.strangerID)
		f.grantPerms(f.strangerID, 0)
		f.grantPerms(f.ownerID, 0)
		f.presence.put(f.channelID, f.strangerID, f.ownerID) // creator left, no admin present
		f.repo.On("GetLinkTargetByID", target.Link.ID).Return(target, nil)
		f.repo.On("RevokeLink", target.Link.ID, &f.strangerID, domain.GuestRevokeManual, f.now).Return(nil, nil)

		require.NoError(t, f.uc.RevokeLink(target.Link.ID, f.strangerID))
	})

	t.Run("fallback does not apply to someone outside the call", func(t *testing.T) {
		f := newGuestUCFixture(t)
		target := newTarget(f, f.memberID)
		f.grantAccess(f.strangerID)
		f.grantPerms(f.strangerID, 0)
		f.repo.On("GetLinkTargetByID", target.Link.ID).Return(target, nil)

		assert.ErrorIs(t, f.uc.RevokeLink(target.Link.ID, f.strangerID), domain.ErrForbidden)
	})
}

func TestGuestUC_AdmitAndReject(t *testing.T) {
	f := newGuestUCFixture(t)
	gc := f.guestCtx(domain.GuestStatusLobby, &f.memberID)
	f.grantAccess(f.memberID)
	f.presence.put(f.channelID, f.memberID)
	f.repo.On("GetGuest", gc.Guest.ID).Return(gc, nil)
	admitted := &domain.CallGuest{ID: gc.Guest.ID, ChannelID: f.channelID, Status: domain.GuestStatusAdmitted}
	f.repo.On("Decide", gc.Guest.ID, f.memberID, true, f.now).Return(admitted, nil)

	require.NoError(t, f.uc.Admit(gc.Guest.ID, f.memberID))
	require.Len(t, f.events.lobbyResolved, 1)
	assert.Equal(t, admitted, f.events.lobbyResolved[0])
	require.NotNil(t, f.events.resolvedBy[0])
	assert.Equal(t, f.memberID, *f.events.resolvedBy[0])
	assert.Empty(t, f.events.ended, "an admitted guest is not ended")

	rejected := &domain.CallGuest{ID: gc.Guest.ID, ChannelID: f.channelID, Status: domain.GuestStatusRejected}
	f.repo.On("Decide", gc.Guest.ID, f.memberID, false, f.now).Return(rejected, nil)
	require.NoError(t, f.uc.Reject(gc.Guest.ID, f.memberID))
	assert.Equal(t, []uuid.UUID{rejected.ID}, f.events.endedIDs(), "a rejected guest is disconnected")
}

// Н15
func TestGuestUC_AdmitRequiresBeingInTheCall(t *testing.T) {
	f := newGuestUCFixture(t)
	gc := f.guestCtx(domain.GuestStatusLobby, &f.memberID)
	f.grantAccess(f.memberID)
	f.repo.On("GetGuest", gc.Guest.ID).Return(gc, nil)

	assert.ErrorIs(t, f.uc.Admit(gc.Guest.ID, f.memberID), domain.ErrNotInCall)
	f.repo.AssertNotCalled(t, "Decide", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestGuestUC_Kick(t *testing.T) {
	f := newGuestUCFixture(t)
	gc := f.guestCtx(domain.GuestStatusAdmitted, &f.memberID)
	f.grantAccess(f.memberID)
	f.repo.On("GetGuest", gc.Guest.ID).Return(gc, nil)
	kicked := &domain.CallGuest{ID: gc.Guest.ID, ChannelID: f.channelID, Status: domain.GuestStatusKicked, Banned: true}
	f.repo.On("EndGuest", gc.Guest.ID, domain.GuestStatusKicked, &f.memberID, true, f.now).Return(kicked, nil)

	require.NoError(t, f.uc.Kick(gc.Guest.ID, f.memberID, true))
	assert.Equal(t, []uuid.UUID{kicked.ID}, f.events.endedIDs())
	assert.Empty(t, f.events.lobbyResolved, "an admitted guest was not waiting in the lobby")
}

func TestGuestUC_KickRequiresModeration(t *testing.T) {
	f := newGuestUCFixture(t)
	gc := f.guestCtx(domain.GuestStatusAdmitted, &f.memberID)
	f.grantAccess(f.strangerID)
	f.grantPerms(f.strangerID, 0)
	f.grantPerms(f.memberID, 0)
	f.presence.put(f.channelID, f.strangerID, f.memberID)
	f.repo.On("GetGuest", gc.Guest.ID).Return(gc, nil)

	assert.ErrorIs(t, f.uc.Kick(gc.Guest.ID, f.strangerID, false), domain.ErrForbidden)
}

// Н14
func TestGuestUC_SetServerGuestLinks(t *testing.T) {
	f := newGuestUCFixture(t)
	f.grantPerms(f.ownerID, domain.PermManageServer)
	ended := []*domain.CallGuest{{ID: uuid.New(), ChannelID: f.channelID, Status: domain.GuestStatusRevoked}}
	f.repo.On("SetServerGuestLinks", f.serverID, false, f.ownerID, f.now).Return(ended, nil)
	updated := &domain.Server{ID: f.serverID, GuestLinksEnabled: false}
	f.servers.On("GetByID", f.serverID).Return(updated, nil)

	got, err := f.uc.SetServerGuestLinks(f.serverID, f.ownerID, false)
	require.NoError(t, err)
	assert.Equal(t, updated, got)
	assert.Equal(t, []uuid.UUID{ended[0].ID}, f.events.endedIDs())
	assert.Equal(t, []uuid.UUID{f.channelID}, f.events.linksChanged)

	f.grantPerms(f.strangerID, domain.PermSendMessages)
	_, err = f.uc.SetServerGuestLinks(f.serverID, f.strangerID, false)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

// Rule 1 of the moderation gap: the creator leaving closes their links to new guests.
func TestGuestUC_OnParticipantLeft(t *testing.T) {
	f := newGuestUCFixture(t)
	f.repo.On("CloseCreatorLinksInChannel", f.channelID, f.memberID, f.now).Return(int64(2), nil).Once()
	f.uc.OnParticipantLeft(f.channelID, f.memberID)
	assert.Equal(t, []uuid.UUID{f.channelID}, f.events.linksChanged)

	f.repo.On("CloseCreatorLinksInChannel", f.channelID, f.strangerID, f.now).Return(int64(0), nil).Once()
	f.uc.OnParticipantLeft(f.channelID, f.strangerID)
	assert.Len(t, f.events.linksChanged, 1, "nothing closed — nothing to tell clients")
}
