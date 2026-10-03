package postgres_test

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

func TestNewReactionRepositorySignature(t *testing.T) {
	var _ func(*pgxpool.Pool) domain.ReactionRepository = postgres.NewReactionRepository
}

type reactionFixture struct {
	pool                *pgxpool.Pool
	repo                domain.ReactionRepository
	a, b, server, msgID uuid.UUID
}

func newReactionFixture(t *testing.T) *reactionFixture {
	t.Helper()
	pool := openIntegrationDB(t)
	a, b := seedUser(t, pool), seedUser(t, pool)
	srv := seedServer(t, pool, a, false)
	ch := seedChannel(t, pool, srv)
	msg := uuid.New()
	exec(t, pool, `INSERT INTO messages (id, channel_id, user_id, content, created_at, updated_at) VALUES ($1, $2, $3, 'x', now(), now())`, msg, ch, a)
	return &reactionFixture{pool: pool, repo: postgres.NewReactionRepository(pool), a: a, b: b, server: srv, msgID: msg}
}

func emoji(e string) domain.ReactionKey { return domain.ReactionKey{Emoji: e} }

func (f *reactionFixture) sticker(t *testing.T) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, f.pool, `INSERT INTO stickers (id, server_id, name, image_url, created_by) VALUES ($1, $2, 'cat', '/uploads/cat.png', $3)`, id, f.server, f.a)
	return id
}

func TestReactions_AddAggregatesAndIsIdempotent(t *testing.T) {
	f := newReactionFixture(t)
	_, err := f.repo.Add(f.msgID, f.a, emoji("👍"), 20)
	require.NoError(t, err)
	_, err = f.repo.Add(f.msgID, f.b, emoji("❤️"), 20)
	require.NoError(t, err)
	_, err = f.repo.Add(f.msgID, f.b, emoji("👍"), 20)
	require.NoError(t, err)
	snap, err := f.repo.Add(f.msgID, f.b, emoji("👍"), 20) // повтор — без изменений
	require.NoError(t, err)

	require.Len(t, snap, 2)
	assert.Equal(t, "👍", snap[0].Key, "порядок — по первой реакции вида")
	assert.Equal(t, 2, snap[0].Count)
	assert.Equal(t, []uuid.UUID{f.a, f.b}, snap[0].UserIDs)
	assert.Equal(t, "❤️", snap[1].Key)
	assert.Equal(t, 1, snap[1].Count)
}

func TestReactions_StickerSnapshotCarriesSticker(t *testing.T) {
	f := newReactionFixture(t)
	sid := f.sticker(t)
	snap, err := f.repo.Add(f.msgID, f.a, domain.ReactionKey{StickerID: &sid}, 20)
	require.NoError(t, err)
	require.Len(t, snap, 1)
	assert.Equal(t, "sticker:"+sid.String(), snap[0].Key)
	assert.Empty(t, snap[0].Emoji)
	require.NotNil(t, snap[0].Sticker)
	assert.Equal(t, "cat", snap[0].Sticker.Name)
	assert.Equal(t, f.server, snap[0].Sticker.ServerID)
}

func TestReactions_RemoveIsIdempotentAndEmptySnapshotIsNotNil(t *testing.T) {
	f := newReactionFixture(t)
	_, err := f.repo.Add(f.msgID, f.a, emoji("👍"), 20)
	require.NoError(t, err)
	snap, err := f.repo.Remove(f.msgID, f.a, emoji("👍"))
	require.NoError(t, err)
	assert.NotNil(t, snap)
	assert.Empty(t, snap)
	snap, err = f.repo.Remove(f.msgID, f.a, emoji("👍"))
	require.NoError(t, err)
	assert.Empty(t, snap)
}

func TestReactions_LimitCountsKindsNotUsers(t *testing.T) {
	f := newReactionFixture(t)
	_, err := f.repo.Add(f.msgID, f.a, emoji("👍"), 2)
	require.NoError(t, err)
	_, err = f.repo.Add(f.msgID, f.a, emoji("❤️"), 2)
	require.NoError(t, err)

	_, err = f.repo.Add(f.msgID, f.a, emoji("🔥"), 2)
	assert.ErrorIs(t, err, domain.ErrReactionLimitReached)

	snap, err := f.repo.Add(f.msgID, f.b, emoji("👍"), 2) // существующий вид — можно
	require.NoError(t, err)
	assert.Equal(t, 2, snap[0].Count)
}

func TestReactions_ConcurrentAddsRespectLimit(t *testing.T) {
	f := newReactionFixture(t)
	base := []string{"😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😜", "🤪", "🤔", "😎", "🤩", "🥳", "😭", "😡", "😱", "🥺", "😴", "🤯"}
	for _, e := range base { // 19 видов
		_, err := f.repo.Add(f.msgID, f.a, emoji(e), 20)
		require.NoError(t, err)
	}
	extra := []string{"🐶", "🐱", "🦊", "🐻", "🐼", "🐨", "🦁", "🐯"}
	var wg sync.WaitGroup
	for _, e := range extra {
		wg.Add(1)
		go func(e string) {
			defer wg.Done()
			_, _ = f.repo.Add(f.msgID, f.b, emoji(e), 20)
		}(e)
	}
	wg.Wait()

	var kinds int
	require.NoError(t, f.pool.QueryRow(context.Background(),
		`SELECT COUNT(DISTINCT COALESCE(emoji, sticker_id::text)) FROM message_reactions WHERE message_id = $1`, f.msgID).Scan(&kinds))
	assert.Equal(t, 20, kinds)
}

func TestReactions_Cascades(t *testing.T) {
	f := newReactionFixture(t)
	sid := f.sticker(t)
	_, err := f.repo.Add(f.msgID, f.a, domain.ReactionKey{StickerID: &sid}, 20)
	require.NoError(t, err)
	_, err = f.repo.Add(f.msgID, f.b, emoji("👍"), 20)
	require.NoError(t, err)

	exec(t, f.pool, `DELETE FROM stickers WHERE id = $1`, sid)
	exec(t, f.pool, `DELETE FROM users WHERE id = $1`, f.b)
	byMsg, err := f.repo.ListByMessageIDs([]uuid.UUID{f.msgID})
	require.NoError(t, err)
	assert.Empty(t, byMsg[f.msgID])

	_, err = f.repo.Add(f.msgID, f.a, emoji("👍"), 20)
	require.NoError(t, err)
	exec(t, f.pool, `DELETE FROM messages WHERE id = $1`, f.msgID)
	var n int
	require.NoError(t, f.pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM message_reactions`).Scan(&n))
	assert.Zero(t, n)
}

func TestReactions_AddUnknownMessage(t *testing.T) {
	f := newReactionFixture(t)
	_, err := f.repo.Add(uuid.New(), f.a, emoji("👍"), 20)
	assert.ErrorIs(t, err, domain.ErrMessageNotFound)
}

func TestReactions_AddDeletedStickerMapsToNotFound(t *testing.T) {
	f := newReactionFixture(t)
	gone := uuid.New()
	_, err := f.repo.Add(f.msgID, f.a, domain.ReactionKey{StickerID: &gone}, 20)
	assert.ErrorIs(t, err, domain.ErrStickerNotFound)
}

func TestReactions_ListByMessageIDsGroupsPerMessage(t *testing.T) {
	f := newReactionFixture(t)
	_, err := f.repo.Add(f.msgID, f.a, emoji("👍"), 20)
	require.NoError(t, err)
	byMsg, err := f.repo.ListByMessageIDs([]uuid.UUID{f.msgID, uuid.New()})
	require.NoError(t, err)
	require.Len(t, byMsg[f.msgID], 1)
	empty, err := f.repo.ListByMessageIDs(nil)
	require.NoError(t, err)
	assert.Empty(t, empty)
}
