package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
	"github.com/vycord/server/pkg/authtoken"
)

type guestRepoFixture struct {
	*callFixture
	repo *postgres.GuestRepositoryForTest
	now  time.Time
}

func newGuestRepoFixture(t *testing.T, guestLinksEnabled bool) *guestRepoFixture {
	t.Helper()
	cf := newCallFixture(t, guestLinksEnabled)
	return &guestRepoFixture{
		callFixture: cf,
		repo:        postgres.NewGuestRepositoryForTest(cf.pool),
		// Postgres stores microseconds: truncate so round-tripped times compare equal.
		now: time.Now().Truncate(time.Microsecond),
	}
}

func (f *guestRepoFixture) createLink(t *testing.T, creator uuid.UUID) (*domain.GuestLink, string) {
	t.Helper()
	secret, err := authtoken.GenerateOpaqueSecret()
	require.NoError(t, err)
	c := creator
	link := &domain.GuestLink{
		ID: uuid.New(), ChannelID: f.channelID, CallMessageID: f.callID,
		CreatedBy: &c, CreatedAt: f.now, ExpiresAt: f.now.Add(domain.GuestLinkTTL),
	}
	require.NoError(t, f.repo.CreateLink(link, authtoken.HashOpaqueSecret(secret)))
	return link, secret
}

func (f *guestRepoFixture) join(t *testing.T, linkID uuid.UUID, ip string) (*domain.CallGuest, string, error) {
	t.Helper()
	session, err := authtoken.GenerateOpaqueSecret()
	require.NoError(t, err)
	g, err := f.repo.Join(domain.GuestJoin{
		LinkID: linkID, GuestID: uuid.New(), DisplayName: "Гость " + shortID(),
		SessionHash: authtoken.HashOpaqueSecret(session), IPHash: []byte("ip:" + ip), Now: f.now,
	})
	return g, session, err
}

func TestGuestRepo_OpenCallMessageID(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	id, err := f.repo.OpenCallMessageID(f.channelID)
	require.NoError(t, err)
	assert.Equal(t, f.callID, id)

	seedEndCall(t, f.pool, f.callID)
	_, err = f.repo.OpenCallMessageID(f.channelID)
	assert.ErrorIs(t, err, domain.ErrCallNotActive)
}

func TestGuestRepo_CreateLinkAndLookup(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, secret := f.createLink(t, f.ownerID)

	bySecret, err := f.repo.GetLinkTargetBySecretHash(authtoken.HashOpaqueSecret(secret))
	require.NoError(t, err)
	assert.Equal(t, link.ID, bySecret.Link.ID)
	assert.Equal(t, f.serverID, bySecret.ServerID)
	assert.NotEmpty(t, bySecret.ServerName)
	assert.NotEmpty(t, bySecret.ChannelName)
	assert.True(t, bySecret.GuestLinksEnabled)
	assert.Nil(t, bySecret.CallEndedAt)
	assert.Equal(t, 0, bySecret.Link.Uses)
	require.NotNil(t, bySecret.Link.CreatedBy)
	assert.Equal(t, f.ownerID, *bySecret.Link.CreatedBy)
	assert.True(t, link.ExpiresAt.Equal(bySecret.Link.ExpiresAt))
	assert.NoError(t, bySecret.Usable(f.now))

	byID, err := f.repo.GetLinkTargetByID(link.ID)
	require.NoError(t, err)
	assert.Equal(t, link.ID, byID.Link.ID)

	_, err = f.repo.GetLinkTargetBySecretHash(authtoken.HashOpaqueSecret("not-a-secret"))
	assert.ErrorIs(t, err, domain.ErrGuestLinkInvalid)
	_, err = f.repo.GetLinkTargetBySecretHash(nil)
	assert.ErrorIs(t, err, domain.ErrGuestLinkInvalid)
	_, err = f.repo.GetLinkTargetByID(uuid.New())
	assert.ErrorIs(t, err, domain.ErrGuestLinkNotFound)
}

func TestGuestRepo_CreateLinkRejectsClosedCall(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	seedEndCall(t, f.pool, f.callID)
	c := f.ownerID
	err := f.repo.CreateLink(&domain.GuestLink{
		ID: uuid.New(), ChannelID: f.channelID, CallMessageID: f.callID,
		CreatedBy: &c, CreatedAt: f.now, ExpiresAt: f.now.Add(time.Hour),
	}, []byte("h"))
	assert.ErrorIs(t, err, domain.ErrCallNotActive)
}

func TestGuestRepo_CreateLinkLimitPerCreator(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	var first *domain.GuestLink
	for i := 0; i < domain.MaxActiveLinksPerCreatorPerCall; i++ {
		l, _ := f.createLink(t, f.ownerID)
		if first == nil {
			first = l
		}
	}
	c := f.ownerID
	err := f.repo.CreateLink(&domain.GuestLink{
		ID: uuid.New(), ChannelID: f.channelID, CallMessageID: f.callID,
		CreatedBy: &c, CreatedAt: f.now, ExpiresAt: f.now.Add(time.Hour),
	}, []byte("fourth"))
	assert.ErrorIs(t, err, domain.ErrTooManyGuestLinks)

	other := seedUser(t, f.pool)
	f.createLink(t, other) // a different creator is not limited by the owner's links

	exec(t, f.pool, `UPDATE call_guest_links SET revoked_at = now(), revoke_reason = 'manual' WHERE id = $1`, first.ID)
	f.createLink(t, f.ownerID) // a revoked link frees a slot
}

func TestGuestRepo_ListCallState(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	live, _ := f.createLink(t, f.ownerID)
	revoked, _ := f.createLink(t, f.ownerID)
	exec(t, f.pool, `UPDATE call_guest_links SET revoked_at = now(), revoke_reason = 'manual' WHERE id = $1`, revoked.ID)
	seedGuest(t, f.pool, live.ID, f.channelID, f.callID, "lobby", false)
	seedGuest(t, f.pool, live.ID, f.channelID, f.callID, "admitted", true)
	seedGuest(t, f.pool, live.ID, f.channelID, f.callID, "left", true)

	state, err := f.repo.ListCallState(f.callID)
	require.NoError(t, err)
	require.Len(t, state.Links, 1)
	assert.Equal(t, live.ID, state.Links[0].ID)
	assert.Len(t, state.Guests, 2)

	empty, err := f.repo.ListCallState(uuid.New())
	require.NoError(t, err)
	assert.NotNil(t, empty.Links)
	assert.NotNil(t, empty.Guests)
}

func TestGuestRepo_CloseCreatorLinksInChannel(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	other := seedUser(t, f.pool)
	f.createLink(t, f.ownerID)
	f.createLink(t, f.ownerID)
	otherLink, _ := f.createLink(t, other)

	n, err := f.repo.CloseCreatorLinksInChannel(f.channelID, f.ownerID, f.now)
	require.NoError(t, err)
	assert.EqualValues(t, 2, n)

	n, err = f.repo.CloseCreatorLinksInChannel(f.channelID, f.ownerID, f.now)
	require.NoError(t, err)
	assert.EqualValues(t, 0, n, "already closed links are not closed again")

	target, err := f.repo.GetLinkTargetByID(otherLink.ID)
	require.NoError(t, err)
	assert.Nil(t, target.Link.ClosedAt, "another creator's link stays open")
}
