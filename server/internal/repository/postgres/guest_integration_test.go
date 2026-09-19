package postgres_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
	"github.com/vycord/server/pkg/authtoken"
)

func TestGuestRepo_ImplementsInterface(t *testing.T) {
	var _ domain.GuestRepository = postgres.NewGuestRepository(nil)
}

func TestGuestRepo_JoinCreatesLobbyGuest(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)

	g, session, err := f.join(t, link.ID, "a")
	require.NoError(t, err)
	assert.Equal(t, domain.GuestStatusLobby, g.Status)
	assert.Equal(t, f.channelID, g.ChannelID)
	assert.Equal(t, f.callID, g.CallMessageID)

	target, err := f.repo.GetLinkTargetByID(link.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, target.Link.Uses)

	ctx, err := f.repo.GetSessionByHash(authtoken.HashOpaqueSecret(session))
	require.NoError(t, err)
	assert.Equal(t, g.ID, ctx.Guest.ID)
	assert.Equal(t, f.serverID, ctx.ServerID)
	require.NotNil(t, ctx.LinkCreatedBy)
	assert.Equal(t, f.ownerID, *ctx.LinkCreatedBy)
	assert.True(t, ctx.SessionUsable())

	byID, err := f.repo.GetGuest(g.ID)
	require.NoError(t, err)
	assert.Equal(t, g.DisplayName, byID.Guest.DisplayName)

	_, err = f.repo.GetSessionByHash(authtoken.HashOpaqueSecret("nope"))
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid)
	_, err = f.repo.GetSessionByHash(nil)
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid)
	_, err = f.repo.GetGuest(uuid.New())
	assert.ErrorIs(t, err, domain.ErrGuestNotFound)
}

// Н8, Н9, Н10, Н17 and the server toggle at the repository layer.
func TestGuestRepo_JoinRejectsUnusableLink(t *testing.T) {
	cases := map[string]struct {
		prepare func(t *testing.T, f *guestRepoFixture, link *domain.GuestLink)
		want    error
	}{
		"expired (Н10)": {func(t *testing.T, f *guestRepoFixture, l *domain.GuestLink) {
			exec(t, f.pool, `UPDATE call_guest_links SET expires_at = $2 WHERE id = $1`, l.ID, f.now.Add(-time.Minute))
		}, domain.ErrGuestLinkExpired},
		"revoked (Н8)": {func(t *testing.T, f *guestRepoFixture, l *domain.GuestLink) {
			_, err := f.repo.RevokeLink(l.ID, &f.ownerID, domain.GuestRevokeManual, f.now)
			require.NoError(t, err)
		}, domain.ErrGuestLinkRevoked},
		"call ended (Н9)": {func(t *testing.T, f *guestRepoFixture, _ *domain.GuestLink) {
			seedEndCall(t, f.pool, f.callID)
		}, domain.ErrGuestCallEnded},
		"closed (Н17)": {func(t *testing.T, f *guestRepoFixture, _ *domain.GuestLink) {
			_, err := f.repo.CloseCreatorLinksInChannel(f.channelID, f.ownerID, f.now)
			require.NoError(t, err)
		}, domain.ErrGuestLinkClosed},
		"server disabled": {func(t *testing.T, f *guestRepoFixture, _ *domain.GuestLink) {
			exec(t, f.pool, `UPDATE servers SET guest_links_enabled = false WHERE id = $1`, f.serverID)
		}, domain.ErrGuestLinksDisabled},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			f := newGuestRepoFixture(t, true)
			link, _ := f.createLink(t, f.ownerID)
			c.prepare(t, f, link)
			_, _, err := f.join(t, link.ID, "a")
			assert.ErrorIs(t, err, c.want)
		})
	}

	t.Run("unknown link", func(t *testing.T) {
		f := newGuestRepoFixture(t, true)
		_, _, err := f.join(t, uuid.New(), "a")
		assert.ErrorIs(t, err, domain.ErrGuestLinkInvalid)
	})
}

// Н18
func TestGuestRepo_JoinLimits(t *testing.T) {
	t.Run("lobby full per link", func(t *testing.T) {
		f := newGuestRepoFixture(t, true)
		link, _ := f.createLink(t, f.ownerID)
		for i := 0; i < domain.MaxLobbyPerLink; i++ {
			_, _, err := f.join(t, link.ID, "a")
			require.NoError(t, err)
		}
		_, _, err := f.join(t, link.ID, "a")
		assert.ErrorIs(t, err, domain.ErrGuestLobbyFull)
	})

	t.Run("call full across links", func(t *testing.T) {
		f := newGuestRepoFixture(t, true)
		l1, _ := f.createLink(t, f.ownerID)
		l2, _ := f.createLink(t, f.ownerID)
		l3, _ := f.createLink(t, seedUser(t, f.pool))
		for _, l := range []*domain.GuestLink{l1, l2} {
			for i := 0; i < domain.MaxLobbyPerLink; i++ {
				_, _, err := f.join(t, l.ID, "a")
				require.NoError(t, err)
			}
		}
		_, _, err := f.join(t, l3.ID, "a")
		assert.ErrorIs(t, err, domain.ErrGuestCallFull)
	})

	t.Run("join limit per link", func(t *testing.T) {
		f := newGuestRepoFixture(t, true)
		link, _ := f.createLink(t, f.ownerID)
		for i := 0; i < domain.MaxJoinsPerLink; i++ {
			g, _, err := f.join(t, link.ID, "a")
			require.NoError(t, err, "join %d", i+1)
			_, err = f.repo.EndGuest(g.ID, domain.GuestStatusLeft, nil, false, f.now)
			require.NoError(t, err)
		}
		_, _, err := f.join(t, link.ID, "a")
		assert.ErrorIs(t, err, domain.ErrGuestLinkExhausted)
	})
}

func TestGuestRepo_ConcurrentJoinsRespectCallLimit(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	links := []*domain.GuestLink{}
	for i := 0; i < 3; i++ {
		creator := f.ownerID
		if i == 2 {
			creator = seedUser(t, f.pool)
		}
		l, _ := f.createLink(t, creator)
		links = append(links, l)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	ok, full := 0, 0
	for i := 0; i < 15; i++ {
		wg.Add(1)
		go func(link *domain.GuestLink) {
			defer wg.Done()
			_, err := f.repo.Join(domain.GuestJoin{
				LinkID: link.ID, GuestID: uuid.New(), DisplayName: "g",
				SessionHash: authtoken.HashOpaqueSecret(uuid.NewString()), IPHash: []byte("ip"), Now: f.now,
			})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case errors.Is(err, domain.ErrGuestCallFull):
				full++
			default:
				t.Errorf("unexpected join error: %v", err)
			}
		}(links[i%3])
	}
	wg.Wait()
	assert.Equal(t, domain.MaxGuestsPerCall, ok)
	assert.Equal(t, 15-domain.MaxGuestsPerCall, full)
}

// Н11
func TestGuestRepo_BanByIP(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)
	g, _, err := f.join(t, link.ID, "A")
	require.NoError(t, err)
	_, err = f.repo.Decide(g.ID, f.ownerID, true, f.now)
	require.NoError(t, err)

	kicked, err := f.repo.EndGuest(g.ID, domain.GuestStatusKicked, &f.ownerID, true, f.now)
	require.NoError(t, err)
	assert.Equal(t, domain.GuestStatusKicked, kicked.Status)
	assert.True(t, kicked.Banned)

	_, _, err = f.join(t, link.ID, "A")
	assert.ErrorIs(t, err, domain.ErrGuestBanned)

	_, _, err = f.join(t, link.ID, "B")
	assert.NoError(t, err)

	var withHash int
	require.NoError(t, f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM call_guests WHERE id = $1 AND ip_hash IS NOT NULL AND session_hash IS NULL`, g.ID).Scan(&withHash))
	assert.Equal(t, 1, withHash, "a banned guest keeps ip_hash but loses session_hash")
}

// Н28 and the lobby decision contract.
func TestGuestRepo_Decide(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)

	g1, _, err := f.join(t, link.ID, "a")
	require.NoError(t, err)
	admitted, err := f.repo.Decide(g1.ID, f.ownerID, true, f.now)
	require.NoError(t, err)
	assert.Equal(t, domain.GuestStatusAdmitted, admitted.Status)
	require.NotNil(t, admitted.AdmittedAt)

	_, err = f.repo.Decide(g1.ID, seedUser(t, f.pool), true, f.now)
	assert.ErrorIs(t, err, domain.ErrGuestAlreadyDecided)

	g2, s2, err := f.join(t, link.ID, "a")
	require.NoError(t, err)
	rejected, err := f.repo.Decide(g2.ID, f.ownerID, false, f.now)
	require.NoError(t, err)
	assert.Equal(t, domain.GuestStatusRejected, rejected.Status)
	_, err = f.repo.GetSessionByHash(authtoken.HashOpaqueSecret(s2))
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid)

	_, err = f.repo.Decide(uuid.New(), f.ownerID, true, f.now)
	assert.ErrorIs(t, err, domain.ErrGuestNotFound)

	g3, _, err := f.join(t, link.ID, "a")
	require.NoError(t, err)
	seedEndCall(t, f.pool, f.callID)
	_, err = f.repo.Decide(g3.ID, f.ownerID, true, f.now)
	assert.ErrorIs(t, err, domain.ErrGuestCallEnded)
}

func TestGuestRepo_EndGuest(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)
	g, session, err := f.join(t, link.ID, "a")
	require.NoError(t, err)

	left, err := f.repo.EndGuest(g.ID, domain.GuestStatusLeft, nil, false, f.now)
	require.NoError(t, err)
	assert.Equal(t, domain.GuestStatusLeft, left.Status)
	require.NotNil(t, left.EndedAt)

	_, err = f.repo.GetSessionByHash(authtoken.HashOpaqueSecret(session))
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid)

	_, err = f.repo.EndGuest(g.ID, domain.GuestStatusKicked, &f.ownerID, false, f.now)
	assert.ErrorIs(t, err, domain.ErrGuestNotActive)
	_, err = f.repo.EndGuest(uuid.New(), domain.GuestStatusLeft, nil, false, f.now)
	assert.ErrorIs(t, err, domain.ErrGuestNotFound)
	_, err = f.repo.EndGuest(g.ID, domain.GuestStatusAdmitted, nil, false, f.now)
	assert.Error(t, err, "EndGuest must refuse non-final target statuses")
}

// Н8
func TestGuestRepo_RevokeLinkEndsActiveGuests(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)
	lobby, _, _ := f.join(t, link.ID, "a")
	inCall, session, _ := f.join(t, link.ID, "b")
	_, err := f.repo.Decide(inCall.ID, f.ownerID, true, f.now)
	require.NoError(t, err)
	gone, _, _ := f.join(t, link.ID, "c")
	_, err = f.repo.EndGuest(gone.ID, domain.GuestStatusLeft, nil, false, f.now)
	require.NoError(t, err)

	ended, err := f.repo.RevokeLink(link.ID, &f.ownerID, domain.GuestRevokeManual, f.now)
	require.NoError(t, err)
	ids := map[uuid.UUID]domain.GuestStatus{}
	for _, g := range ended {
		ids[g.ID] = g.Status
	}
	assert.Equal(t, map[uuid.UUID]domain.GuestStatus{
		lobby.ID:  domain.GuestStatusRevoked,
		inCall.ID: domain.GuestStatusRevoked,
	}, ids)

	_, err = f.repo.GetSessionByHash(authtoken.HashOpaqueSecret(session))
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid)

	again, err := f.repo.RevokeLink(link.ID, &f.ownerID, domain.GuestRevokeManual, f.now)
	require.NoError(t, err)
	assert.Empty(t, again)
}

// Н14
func TestGuestRepo_SetServerGuestLinks(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)
	g, _, _ := f.join(t, link.ID, "a")

	ended, err := f.repo.SetServerGuestLinks(f.serverID, false, f.ownerID, f.now)
	require.NoError(t, err)
	require.Len(t, ended, 1)
	assert.Equal(t, g.ID, ended[0].ID)
	assert.Equal(t, domain.GuestStatusRevoked, ended[0].Status)

	target, err := f.repo.GetLinkTargetByID(link.ID)
	require.NoError(t, err)
	assert.False(t, target.GuestLinksEnabled)
	assert.ErrorIs(t, target.Usable(f.now), domain.ErrGuestLinksDisabled)

	ended, err = f.repo.SetServerGuestLinks(f.serverID, true, f.ownerID, f.now)
	require.NoError(t, err)
	assert.Empty(t, ended)
	target, err = f.repo.GetLinkTargetByID(link.ID)
	require.NoError(t, err)
	assert.True(t, target.GuestLinksEnabled)
	assert.ErrorIs(t, target.Usable(f.now), domain.ErrGuestLinksDisabled,
		"re-enabling the server does not resurrect a link revoked by the toggle")

	_, err = f.repo.SetServerGuestLinks(uuid.New(), false, f.ownerID, f.now)
	assert.ErrorIs(t, err, domain.ErrServerNotFound)
}

// Н9
func TestGuestRepo_EndGuestsOfClosedCalls(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)
	active, _, _ := f.join(t, link.ID, "a")
	_, err := f.repo.Decide(active.ID, f.ownerID, true, f.now)
	require.NoError(t, err)
	banned, _, _ := f.join(t, link.ID, "b")
	_, err = f.repo.EndGuest(banned.ID, domain.GuestStatusKicked, &f.ownerID, true, f.now)
	require.NoError(t, err)

	none, err := f.repo.EndGuestsOfClosedCalls(f.now)
	require.NoError(t, err)
	assert.Empty(t, none, "open call: nothing to end")

	seedEndCall(t, f.pool, f.callID)
	ended, err := f.repo.EndGuestsOfClosedCalls(f.now)
	require.NoError(t, err)
	require.Len(t, ended, 1)
	assert.Equal(t, active.ID, ended[0].ID)
	assert.Equal(t, domain.GuestStatusCallEnded, ended[0].Status)

	target, err := f.repo.GetLinkTargetByID(link.ID)
	require.NoError(t, err)
	assert.ErrorIs(t, target.Usable(f.now), domain.ErrGuestCallEnded)

	var hashes int
	require.NoError(t, f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM call_guests WHERE call_message_id = $1 AND (ip_hash IS NOT NULL OR session_hash IS NOT NULL)`,
		f.callID).Scan(&hashes))
	assert.Equal(t, 0, hashes, "call end clears every hash, including a banned guest's ip_hash")

	again, err := f.repo.EndGuestsOfClosedCalls(f.now)
	require.NoError(t, err)
	assert.Empty(t, again)
}

func TestGuestRepo_ExpireLobby(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)

	old, err := f.repo.Join(domain.GuestJoin{
		LinkID: link.ID, GuestID: uuid.New(), DisplayName: "old",
		SessionHash: []byte("s-old"), IPHash: []byte("ip"), Now: f.now.Add(-10 * time.Minute),
	})
	require.NoError(t, err)
	fresh, _, err := f.join(t, link.ID, "a")
	require.NoError(t, err)

	expired, err := f.repo.ExpireLobby(f.now.Add(-domain.GuestLobbyTimeout), f.now)
	require.NoError(t, err)
	require.Len(t, expired, 1)
	assert.Equal(t, old.ID, expired[0].ID)
	assert.Equal(t, domain.GuestStatusLobbyTimeout, expired[0].Status)

	still, err := f.repo.GetGuest(fresh.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.GuestStatusLobby, still.Guest.Status)
}

// Н24: an admit racing a revoke always converges on "revoked", and a guest
// the admit succeeded for is among the guests the revoke reports as ended.
func TestGuestRepo_DecideVersusRevokeRace(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	for i := 0; i < 30; i++ {
		link, _ := f.createLink(t, f.ownerID)
		g, _, err := f.join(t, link.ID, "a")
		require.NoError(t, err)

		var wg sync.WaitGroup
		var decideErr, revokeErr error
		var ended []*domain.CallGuest
		wg.Add(2)
		go func() { defer wg.Done(); _, decideErr = f.repo.Decide(g.ID, f.ownerID, true, f.now) }()
		go func() {
			defer wg.Done()
			ended, revokeErr = f.repo.RevokeLink(link.ID, &f.ownerID, domain.GuestRevokeManual, f.now)
		}()
		wg.Wait()

		require.NoError(t, revokeErr)
		if decideErr != nil {
			require.ErrorIs(t, decideErr, domain.ErrGuestAlreadyDecided)
		}
		got, err := f.repo.GetGuest(g.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.GuestStatusRevoked, got.Guest.Status, "iteration %d", i)
		require.Len(t, ended, 1, "iteration %d", i)
		assert.Equal(t, g.ID, ended[0].ID)
	}
}

func TestGuestRepo_ListAdmittedGuests(t *testing.T) {
	f := newGuestRepoFixture(t, true)
	link, _ := f.createLink(t, f.ownerID)
	admitted, _, _ := f.join(t, link.ID, "a")
	_, err := f.repo.Decide(admitted.ID, f.ownerID, true, f.now)
	require.NoError(t, err)
	f.join(t, link.ID, "b") // still in the lobby
	gone, _, _ := f.join(t, link.ID, "c")
	_, err = f.repo.EndGuest(gone.ID, domain.GuestStatusLeft, nil, false, f.now)
	require.NoError(t, err)

	list, err := f.repo.ListAdmittedGuests()
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, admitted.ID, list[0].ID)
}
