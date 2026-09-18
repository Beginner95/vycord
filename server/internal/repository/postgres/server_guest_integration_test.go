package postgres_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/repository/postgres"
)

func TestServerRepository_ReadsGuestLinksEnabled(t *testing.T) {
	pool := openIntegrationDB(t)
	repo := postgres.NewServerRepository(pool)
	owner := seedUser(t, pool)
	on := seedServer(t, pool, owner, true)
	off := seedServer(t, pool, owner, false)
	exec(t, pool, `INSERT INTO server_members (server_id, user_id) VALUES ($1, $2), ($3, $2)`, on, owner, off)

	got, err := repo.GetByID(on)
	require.NoError(t, err)
	assert.True(t, got.GuestLinksEnabled)

	got, err = repo.GetByID(off)
	require.NoError(t, err)
	assert.False(t, got.GuestLinksEnabled)

	byName, err := repo.GetByName(got.Name)
	require.NoError(t, err)
	assert.False(t, byName.GuestLinksEnabled)

	owned, err := repo.GetByOwner(owner)
	require.NoError(t, err)
	states := map[bool]int{}
	for _, s := range owned {
		states[s.GuestLinksEnabled]++
	}
	assert.Equal(t, map[bool]int{true: 1, false: 1}, states)

	member, err := repo.GetByMember(owner)
	require.NoError(t, err)
	assert.Len(t, member, 2)
}
