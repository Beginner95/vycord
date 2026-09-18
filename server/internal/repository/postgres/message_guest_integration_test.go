package postgres_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/repository/postgres"
)

func TestMessageRepository_GuestAuthoredMessageReads(t *testing.T) {
	f := newCallFixture(t, true)
	repo := postgres.NewMessageRepository(f.pool)
	link := seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)
	guest := seedGuest(t, f.pool, link, f.channelID, f.callID, "admitted", true)

	var guestName string
	require.NoError(t, f.pool.QueryRow(t.Context(), `SELECT display_name FROM call_guests WHERE id = $1`, guest).Scan(&guestName))

	msgID := uuid.New()
	exec(t, f.pool, `INSERT INTO messages (id, channel_id, guest_id, content) VALUES ($1, $2, $3, 'привет из гостя')`, msgID, f.channelID, guest)

	got, err := repo.GetByID(msgID)
	require.NoError(t, err)
	assert.Nil(t, got.UserID)
	require.NotNil(t, got.GuestID)
	assert.Equal(t, guest, *got.GuestID)
	require.NotNil(t, got.Guest)
	assert.Equal(t, guestName, got.Guest.DisplayName)

	list, err := repo.GetByChannelID(f.channelID, 50, 0)
	require.NoError(t, err)
	var found bool
	for _, m := range list {
		if m.ID == msgID {
			found = true
			require.NotNil(t, m.Guest)
		}
	}
	assert.True(t, found, "guest message must be listed")

	around, err := repo.GetAround(f.channelID, msgID, 5)
	require.NoError(t, err)
	assert.NotEmpty(t, around)

	results, total, err := repo.Search(f.channelID, "гостя", 10, 0)
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, results, 1)
	assert.Equal(t, guestName, results[0].Username)
	require.NotNil(t, results[0].Guest)
}

func TestMessageRepository_UserMessageStillHasUserID(t *testing.T) {
	f := newCallFixture(t, true)
	repo := postgres.NewMessageRepository(f.pool)
	msgID := uuid.New()
	exec(t, f.pool, `INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, 'hi')`, msgID, f.channelID, f.ownerID)

	got, err := repo.GetByID(msgID)
	require.NoError(t, err)
	require.NotNil(t, got.UserID)
	assert.Equal(t, f.ownerID, *got.UserID)
	assert.Nil(t, got.Guest)
}

func TestMessageRepository_CallGuestCount(t *testing.T) {
	f := newCallFixture(t, true)
	repo := postgres.NewMessageRepository(f.pool)
	link := seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)
	seedGuest(t, f.pool, link, f.channelID, f.callID, "admitted", true)
	seedGuest(t, f.pool, link, f.channelID, f.callID, "left", true)
	seedGuest(t, f.pool, link, f.channelID, f.callID, "rejected", false) // never admitted — not counted

	call, err := repo.GetByID(f.callID)
	require.NoError(t, err)
	assert.Equal(t, 2, call.CallGuestCount)

	ended, ok, err := repo.EndCall(f.channelID)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, 2, ended.CallGuestCount)
}

func TestMessageRepository_GetByIDUnknownIsNotFound(t *testing.T) {
	f := newCallFixture(t, true)
	repo := postgres.NewMessageRepository(f.pool)
	_, err := repo.GetByID(uuid.New())
	require.Error(t, err)
	assert.ErrorContains(t, err, "message not found")
}
