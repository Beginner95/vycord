package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

func TestMessageRepository_GuestChat(t *testing.T) {
	f := newCallFixture(t, true)
	repo := postgres.NewMessageRepository(f.pool)
	link := seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)
	guestID := seedGuest(t, f.pool, link, f.channelID, f.callID, "admitted", true)

	before := time.Now().Add(-time.Hour)
	exec(t, f.pool, `INSERT INTO messages (id, channel_id, user_id, content, created_at, updated_at) VALUES ($1, $2, $3, 'до впуска', $4, $4)`,
		uuid.New(), f.channelID, f.ownerID, before)

	admittedAt := time.Now().Add(-time.Minute).Truncate(time.Microsecond)
	userMsgID := uuid.New()
	exec(t, f.pool, `INSERT INTO messages (id, channel_id, user_id, content, created_at, updated_at) VALUES ($1, $2, $3, 'после впуска', $4, $4)`,
		userMsgID, f.channelID, f.ownerID, admittedAt.Add(time.Second))

	guestMsg := &domain.Message{
		ID: uuid.New(), ChannelID: f.channelID, GuestID: &guestID, Content: "привет", Kind: "user",
		CreatedAt: admittedAt.Add(2 * time.Second), UpdatedAt: admittedAt.Add(2 * time.Second),
	}
	require.NoError(t, repo.CreateGuest(guestMsg))

	list, err := repo.ListForGuest(f.channelID, admittedAt, nil, 50)
	require.NoError(t, err)
	require.Len(t, list, 2, "messages sent before admission are invisible to the guest")
	assert.Equal(t, userMsgID, list[0].ID)
	assert.Equal(t, "user", list[0].Author.Kind)
	assert.NotEmpty(t, list[0].Author.Username)
	require.NotNil(t, list[0].Author.UserID)
	assert.Equal(t, guestMsg.ID, list[1].ID)
	assert.Equal(t, "guest", list[1].Author.Kind)
	assert.NotEmpty(t, list[1].Author.DisplayName)
	assert.Nil(t, list[1].Author.UserID)

	cursor, err := repo.GetByID(userMsgID)
	require.NoError(t, err)
	after, err := repo.ListForGuest(f.channelID, admittedAt, cursor, 50)
	require.NoError(t, err)
	require.Len(t, after, 1)
	assert.Equal(t, guestMsg.ID, after[0].ID)

	limited, err := repo.ListForGuest(f.channelID, admittedAt, nil, 1)
	require.NoError(t, err)
	assert.Len(t, limited, 1)

	// The call placard is not part of the guest's chat window.
	all, err := repo.ListForGuest(f.channelID, before.Add(-time.Hour), nil, 50)
	require.NoError(t, err)
	for _, m := range all {
		assert.NotEqual(t, f.callID, m.ID)
	}
}
