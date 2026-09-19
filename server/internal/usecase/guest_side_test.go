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

func (f *guestUCFixture) linkTarget(secret string, creator uuid.UUID) *domain.GuestLinkTarget {
	icon := "https://example.test/icon.png"
	target := &domain.GuestLinkTarget{
		Link: domain.GuestLink{
			ID: uuid.New(), ChannelID: f.channelID, CallMessageID: f.callID,
			CreatedBy: &creator, CreatedAt: f.now, ExpiresAt: f.now.Add(time.Hour),
		},
		ServerID: f.serverID, ServerName: "Вебваха", ServerIconURL: &icon,
		GuestLinksEnabled: true, ChannelName: "общий",
	}
	f.repo.On("GetLinkTargetBySecretHash", authtoken.HashOpaqueSecret(secret)).Return(target, nil)
	return target
}

func TestGuestUC_Preview(t *testing.T) {
	f := newGuestUCFixture(t)
	target := f.linkTarget("sec", f.memberID)
	f.presence.put(f.channelID, f.memberID, f.ownerID)
	f.repo.On("ListCallState", target.Link.CallMessageID).Return(&domain.GuestCallState{
		Guests: []*domain.CallGuest{
			{ID: uuid.New(), Status: domain.GuestStatusAdmitted},
			{ID: uuid.New(), Status: domain.GuestStatusLobby},
		},
	}, nil)

	p, err := f.uc.Preview("sec")
	require.NoError(t, err)
	assert.Equal(t, "Вебваха", p.ServerName)
	assert.Equal(t, "общий", p.ChannelName)
	require.NotNil(t, p.ServerIconURL)
	assert.Equal(t, 3, p.ParticipantCount, "two accounts plus one admitted guest; the lobby is not counted")
}

func TestGuestUC_PreviewRefusals(t *testing.T) {
	f := newGuestUCFixture(t)
	_, err := f.uc.Preview("")
	assert.ErrorIs(t, err, domain.ErrGuestLinkInvalid)
	f.repo.AssertNotCalled(t, "GetLinkTargetBySecretHash", mock.Anything)

	f.repo.On("GetLinkTargetBySecretHash", authtoken.HashOpaqueSecret("nope")).Return(nil, domain.ErrGuestLinkInvalid)
	_, err = f.uc.Preview("nope")
	assert.ErrorIs(t, err, domain.ErrGuestLinkInvalid)

	expired := f.linkTarget("old", f.memberID)
	expired.Link.ExpiresAt = f.now.Add(-time.Minute)
	_, err = f.uc.Preview("old")
	assert.ErrorIs(t, err, domain.ErrGuestLinkExpired)
}

func TestGuestUC_Join(t *testing.T) {
	f := newGuestUCFixture(t)
	target := f.linkTarget("sec", f.memberID)

	var captured domain.GuestJoin
	joined := &domain.CallGuest{ID: uuid.New(), LinkID: target.Link.ID, ChannelID: f.channelID, Status: domain.GuestStatusLobby}
	f.repo.On("Join", mock.AnythingOfType("domain.GuestJoin")).
		Run(func(args mock.Arguments) { captured = args.Get(0).(domain.GuestJoin) }).Return(joined, nil)

	res, err := f.uc.Join("sec", "  Вася\u200B  ", "203.0.113.9")
	require.NoError(t, err)
	assert.Equal(t, "Вася", res.DisplayName, "the name is normalised before it is stored")
	assert.Equal(t, joined.ID, res.GuestID)
	assert.NotEmpty(t, res.SessionToken)
	assert.Equal(t, authtoken.HashOpaqueSecret(res.SessionToken), captured.SessionHash, "only the hash reaches the database")
	assert.Equal(t, target.Link.ID, captured.LinkID)
	assert.Len(t, captured.IPHash, 32)
	assert.True(t, captured.Now.Equal(f.now))

	require.Len(t, f.events.lobbyRequested, 1)
	assert.Equal(t, joined, f.events.lobbyRequested[0])
	require.NotNil(t, f.events.requestedBy[0])
	assert.Equal(t, f.memberID, *f.events.requestedBy[0])
	assert.Equal(t, []uuid.UUID{f.channelID}, f.events.linksChanged)
}

// Н19 at the use-case layer: a bad name never reaches the database.
func TestGuestUC_JoinRejectsBadName(t *testing.T) {
	f := newGuestUCFixture(t)
	f.linkTarget("sec", f.memberID)

	_, err := f.uc.Join("sec", "Администратор", "203.0.113.9")
	assert.ErrorIs(t, err, domain.ErrReservedGuestName)
	_, err = f.uc.Join("sec", "\u200B", "203.0.113.9")
	assert.ErrorIs(t, err, domain.ErrInvalidGuestName)
	f.repo.AssertNotCalled(t, "Join", mock.Anything)
}

func TestGuestUC_Authenticate(t *testing.T) {
	f := newGuestUCFixture(t)
	gc := f.guestCtx(domain.GuestStatusAdmitted, &f.memberID)
	f.repo.On("GetSessionByHash", authtoken.HashOpaqueSecret("live")).Return(gc, nil)
	got, err := f.uc.Authenticate("live")
	require.NoError(t, err)
	assert.Equal(t, gc.Guest.ID, got.Guest.ID)

	_, err = f.uc.Authenticate("")
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid)
	f.repo.AssertNotCalled(t, "GetSessionByHash", authtoken.HashOpaqueSecret(""))

	f.repo.On("GetSessionByHash", authtoken.HashOpaqueSecret("gone")).Return(nil, domain.ErrGuestSessionInvalid)
	_, err = f.uc.Authenticate("gone")
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid)

	// Н8/Н9 at the session layer: a live row whose call ended is not a session.
	ended := f.guestCtx(domain.GuestStatusAdmitted, &f.memberID)
	ended.CallEnded = true
	f.repo.On("GetSessionByHash", authtoken.HashOpaqueSecret("ended")).Return(ended, nil)
	_, err = f.uc.Authenticate("ended")
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid)
}

// Н12
func TestGuestUC_RoomTokenAndTURNRequireAdmission(t *testing.T) {
	f := newGuestUCFixture(t)
	lobby := f.guestCtx(domain.GuestStatusLobby, &f.memberID)
	_, _, err := f.uc.IssueRoomToken(lobby)
	assert.ErrorIs(t, err, domain.ErrGuestNotAdmitted)
	_, err = f.uc.TURNCredentials(lobby)
	assert.ErrorIs(t, err, domain.ErrGuestNotAdmitted)

	admitted := f.guestCtx(domain.GuestStatusAdmitted, &f.memberID)
	token, roomID, err := f.uc.IssueRoomToken(admitted)
	require.NoError(t, err)
	assert.Equal(t, f.channelID, roomID)

	claims, err := authtoken.ValidateGuestRoomToken(guestTestSecret, token)
	require.NoError(t, err)
	assert.Equal(t, admitted.Guest.ID, claims.GuestID)
	assert.Equal(t, f.channelID, claims.RoomID)

	// Н2: the guest room token is not an access token.
	_, err = authtoken.ValidateToken(guestTestSecret, token)
	assert.Error(t, err)

	creds, err := f.uc.TURNCredentials(admitted)
	require.NoError(t, err)
	assert.NotNil(t, creds)
	assert.Equal(t, authtoken.GuestIdentity(admitted.Guest.ID), f.turn.identity)
	assert.Equal(t, domain.GuestTURNTTL, f.turn.ttl)
}

func TestGuestUC_Leave(t *testing.T) {
	f := newGuestUCFixture(t)
	gc := f.guestCtx(domain.GuestStatusLobby, &f.memberID)
	left := &domain.CallGuest{ID: gc.Guest.ID, ChannelID: f.channelID, Status: domain.GuestStatusLeft}
	f.repo.On("EndGuest", gc.Guest.ID, domain.GuestStatusLeft, (*uuid.UUID)(nil), false, f.now).Return(left, nil)

	require.NoError(t, f.uc.Leave(gc))
	require.Len(t, f.events.lobbyResolved, 1, "cancelling in the lobby clears the members' toast")
	assert.Nil(t, f.events.resolvedBy[0])
	assert.Equal(t, []uuid.UUID{left.ID}, f.events.endedIDs())
}

func TestGuestUC_ExpireLobbyAndClosedCalls(t *testing.T) {
	f := newGuestUCFixture(t)
	timedOut := []*domain.CallGuest{{ID: uuid.New(), ChannelID: f.channelID, Status: domain.GuestStatusLobbyTimeout}}
	f.repo.On("ExpireLobby", f.now.Add(-domain.GuestLobbyTimeout), f.now).Return(timedOut, nil)
	f.uc.ExpireLobby()
	assert.Equal(t, []uuid.UUID{timedOut[0].ID}, f.events.endedIDs())
	require.Len(t, f.events.lobbyResolved, 1)
	assert.Nil(t, f.events.resolvedBy[0])

	closed := []*domain.CallGuest{{ID: uuid.New(), ChannelID: f.channelID, Status: domain.GuestStatusCallEnded}}
	f.repo.On("EndGuestsOfClosedCalls", f.now).Return(closed, nil)
	f.uc.EndGuestsOfClosedCalls()
	assert.Contains(t, f.events.endedIDs(), closed[0].ID)
}

func TestGuestUC_ImplementsInterface(t *testing.T) {
	var _ domain.GuestUseCase = usecase.NewGuestUseCase(usecase.GuestUseCaseDeps{JWTSecret: "s"})
}

func TestGuestUC_SweepAbsentGuests(t *testing.T) {
	f := newGuestUCFixture(t)
	present := &domain.CallGuest{ID: uuid.New(), ChannelID: f.channelID, Status: domain.GuestStatusAdmitted}
	absent := &domain.CallGuest{ID: uuid.New(), ChannelID: f.channelID, Status: domain.GuestStatusAdmitted}
	f.repo.On("ListAdmittedGuests").Return([]*domain.CallGuest{present, absent}, nil)

	// First tick: the absence starts counting, nobody is removed yet.
	f.uc.SweepAbsentGuests(map[uuid.UUID]struct{}{present.ID: {}})
	f.repo.AssertNotCalled(t, "EndGuest", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)

	// A tick after the grace window: the absent guest is released.
	f.now = f.now.Add(domain.GuestAbsenceGrace + time.Second)
	left := &domain.CallGuest{ID: absent.ID, ChannelID: f.channelID, Status: domain.GuestStatusLeft}
	f.repo.On("EndGuest", absent.ID, domain.GuestStatusLeft, (*uuid.UUID)(nil), false, f.now).Return(left, nil)
	f.uc.SweepAbsentGuests(map[uuid.UUID]struct{}{present.ID: {}})
	assert.Equal(t, []uuid.UUID{left.ID}, f.events.endedIDs())

	// Coming back clears the counter.
	f.uc.SweepAbsentGuests(map[uuid.UUID]struct{}{present.ID: {}, absent.ID: {}})
	assert.Equal(t, []uuid.UUID{left.ID}, f.events.endedIDs(), "a returning guest is not ended twice")
}
