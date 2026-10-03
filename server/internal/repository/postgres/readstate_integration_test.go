package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

type readFixture struct {
	pool                      *pgxpool.Pool
	repo                      domain.ReadStateRepository
	a, b, serverID, channelID uuid.UUID
	// joined — момент вступления a и b. Сообщения кладутся относительно него.
	joined time.Time
}

func newReadFixture(t *testing.T) *readFixture {
	t.Helper()
	pool := openIntegrationDB(t)
	a, b := seedUser(t, pool), seedUser(t, pool)
	srv := seedServer(t, pool, a, false)
	ch := seedChannel(t, pool, srv)
	joined := time.Now().Add(-time.Hour).UTC().Truncate(time.Microsecond)
	exec(t, pool, `INSERT INTO server_members (server_id, user_id, joined_at) VALUES ($1, $2, $4), ($1, $3, $4)`, srv, a, b, joined)
	return &readFixture{pool: pool, repo: postgres.NewReadStateRepository(pool), a: a, b: b, serverID: srv, channelID: ch, joined: joined}
}

// msg вставляет пользовательское сообщение автора author в момент joined+offset.
func (f *readFixture) msg(t *testing.T, author uuid.UUID, offset time.Duration) (uuid.UUID, time.Time) {
	t.Helper()
	return f.msgWithID(t, uuid.New(), author, offset)
}

func (f *readFixture) msgWithID(t *testing.T, id, author uuid.UUID, offset time.Duration) (uuid.UUID, time.Time) {
	t.Helper()
	at := f.joined.Add(offset)
	exec(t, f.pool, `INSERT INTO messages (id, channel_id, user_id, content, created_at, updated_at) VALUES ($1, $2, $3, 'x', $4, $4)`,
		id, f.channelID, author, at)
	return id, at
}

func TestReadState_FallbackToJoinedAt(t *testing.T) {
	f := newReadFixture(t)
	f.msg(t, f.a, -time.Minute) // до вступления — не непрочитано
	f.msg(t, f.a, time.Minute)
	f.msg(t, f.a, 2*time.Minute)

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 2, n)

	cur, err := f.repo.Cursor(f.b, f.channelID)
	require.NoError(t, err)
	assert.True(t, cur.At.Equal(f.joined))
	assert.Nil(t, cur.MessageID)

	list, err := f.repo.ListUnread(f.b)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, f.serverID, list[0].ServerID)
	assert.Equal(t, f.channelID, list[0].ChannelID)
	assert.Equal(t, 2, list[0].Count)
}

func TestReadState_CountsGuestsSkipsOwnAndCalls(t *testing.T) {
	f := newReadFixture(t)
	f.msg(t, f.a, time.Minute)
	f.msg(t, f.b, 2*time.Minute) // своё для b — не считается
	call := seedOpenCall(t, f.pool, f.channelID, f.a)
	link := seedGuestLink(t, f.pool, f.channelID, call, f.a)
	guest := seedGuest(t, f.pool, link, f.channelID, call, "admitted", true)
	exec(t, f.pool, `INSERT INTO messages (id, channel_id, guest_id, content, created_at, updated_at) VALUES ($1, $2, $3, 'g', $4, $4)`,
		uuid.New(), f.channelID, guest, f.joined.Add(3*time.Minute))

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 2, n, "сообщение a + гостевое; своё и call-плашка не считаются")
}

func TestReadState_AdvanceForwardOnlyWithIDTieBreak(t *testing.T) {
	f := newReadFixture(t)
	lo := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	hi := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	_, at := f.msgWithID(t, lo, f.a, time.Minute)
	f.msgWithID(t, hi, f.a, time.Minute) // то же время, id больше
	f.msg(t, f.a, 2*time.Minute)

	moved, err := f.repo.Advance(f.b, f.channelID, at, hi)
	require.NoError(t, err)
	assert.True(t, moved)

	moved, err = f.repo.Advance(f.b, f.channelID, at, lo)
	require.NoError(t, err)
	assert.False(t, moved, "назад по id при том же времени — не двигается")

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	cur, err := f.repo.Cursor(f.b, f.channelID)
	require.NoError(t, err)
	require.NotNil(t, cur.MessageID)
	assert.Equal(t, hi, *cur.MessageID)
}

// Review Focus №2.
func TestReadState_AdvanceBeforeJoinedAtIsRefused(t *testing.T) {
	f := newReadFixture(t)
	old, oldAt := f.msg(t, f.a, -time.Minute)
	f.msg(t, f.a, time.Minute)

	moved, err := f.repo.Advance(f.b, f.channelID, oldAt, old)
	require.NoError(t, err)
	assert.False(t, moved)

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 1, n, "курсор не откатился на сообщение до вступления")
}

// Finding 3: курсор пережил выход с сервера — после повторного вступления
// сообщения между выходом и возвратом не должны стать непрочитанными.
func TestReadState_RejoinResetsStaleCursor(t *testing.T) {
	f := newReadFixture(t)
	id, at := f.msg(t, f.a, time.Minute)
	moved, err := f.repo.Advance(f.b, f.channelID, at, id)
	require.NoError(t, err)
	require.True(t, moved)

	// b выходит, пока идёт переписка, и возвращается позже.
	exec(t, f.pool, `DELETE FROM server_members WHERE server_id = $1 AND user_id = $2`, f.serverID, f.b)
	f.msg(t, f.a, 2*time.Minute)
	f.msg(t, f.a, 3*time.Minute)
	rejoined := f.joined.Add(10 * time.Minute)
	exec(t, f.pool, `INSERT INTO server_members (server_id, user_id, joined_at) VALUES ($1, $2, $3)`, f.serverID, f.b, rejoined)
	f.msg(t, f.a, 11*time.Minute)

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 1, n, "считаются только сообщения после возвращения")

	cur, err := f.repo.Cursor(f.b, f.channelID)
	require.NoError(t, err)
	assert.True(t, cur.At.Equal(rejoined))
	assert.Nil(t, cur.MessageID)

	list, err := f.repo.ListUnread(f.b)
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.Equal(t, 1, list[0].Count)
	assert.True(t, list[0].At.Equal(rejoined))
	assert.Nil(t, list[0].MessageID)

	// Новый явный курсор после возвращения снова работает.
	id2, at2 := f.msg(t, f.a, 12*time.Minute)
	moved, err = f.repo.Advance(f.b, f.channelID, at2, id2)
	require.NoError(t, err)
	assert.True(t, moved)
	n, err = f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, 0, n)
}

func TestReadState_NonMember(t *testing.T) {
	f := newReadFixture(t)
	stranger := seedUser(t, f.pool)
	id, at := f.msg(t, f.a, time.Minute)

	moved, err := f.repo.Advance(stranger, f.channelID, at, id)
	require.NoError(t, err)
	assert.False(t, moved)

	_, err = f.repo.CountUnread(stranger, f.channelID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
	_, err = f.repo.Cursor(stranger, f.channelID)
	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestReadState_CountIsCapped(t *testing.T) {
	f := newReadFixture(t)
	exec(t, f.pool, `
		INSERT INTO messages (channel_id, user_id, content, created_at, updated_at)
		SELECT $1, $2, 'x', $3::timestamptz + g * interval '1 millisecond', $3::timestamptz + g * interval '1 millisecond'
		FROM generate_series(1, 105) g`, f.channelID, f.a, f.joined)

	n, err := f.repo.CountUnread(f.b, f.channelID)
	require.NoError(t, err)
	assert.Equal(t, domain.UnreadCountCap, n)
}

func TestReadState_OthersMaxUsesOnlyExplicitCursors(t *testing.T) {
	f := newReadFixture(t)
	id, at := f.msg(t, f.a, time.Minute)

	cur, err := f.repo.OthersMax(f.a, f.channelID)
	require.NoError(t, err)
	assert.Nil(t, cur, "у b нет явного курсора — фолбэк на joined_at не считается прочтением")

	_, err = f.repo.Advance(f.b, f.channelID, at, id)
	require.NoError(t, err)

	cur, err = f.repo.OthersMax(f.a, f.channelID)
	require.NoError(t, err)
	require.NotNil(t, cur)
	require.NotNil(t, cur.MessageID)
	assert.Equal(t, id, *cur.MessageID)

	own, err := f.repo.OthersMax(f.b, f.channelID)
	require.NoError(t, err)
	assert.Nil(t, own, "свой курсор в «другие» не входит")
}

func TestReadState_Readers(t *testing.T) {
	f := newReadFixture(t)
	c := seedUser(t, f.pool)
	exec(t, f.pool, `INSERT INTO server_members (server_id, user_id, joined_at) VALUES ($1, $2, $3)`, f.serverID, c, f.joined)
	m1, at1 := f.msg(t, f.a, time.Minute)
	m2, at2 := f.msg(t, f.a, 2*time.Minute)
	_, err := f.repo.Advance(f.b, f.channelID, at1, m1)
	require.NoError(t, err)

	byID := func(rs []*domain.Reader) map[uuid.UUID]bool {
		out := map[uuid.UUID]bool{}
		for _, r := range rs {
			out[r.UserID] = r.HasRead
		}
		return out
	}

	rs, err := f.repo.Readers(f.serverID, f.channelID, at1, m1, f.a)
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]bool{f.b: true, c: false}, byID(rs), "автор исключён, c без курсора — не прочитал")

	rs, err = f.repo.Readers(f.serverID, f.channelID, at2, m2, f.a)
	require.NoError(t, err)
	assert.Equal(t, map[uuid.UUID]bool{f.b: false, c: false}, byID(rs))
}

func TestReadState_ServerMemberIDs(t *testing.T) {
	f := newReadFixture(t)
	ids, err := f.repo.ServerMemberIDs(f.serverID)
	require.NoError(t, err)
	assert.ElementsMatch(t, []uuid.UUID{f.a, f.b}, ids)
}

func TestMigration029_SeedsExistingMembers(t *testing.T) {
	f := newReadFixture(t)
	second := seedChannel(t, f.pool, f.serverID)
	applyMigrationSection(t, f.pool, 29, "down")
	applyMigrationSection(t, f.pool, 29, "up")

	var n int
	require.NoError(t, f.pool.QueryRow(t.Context(),
		`SELECT count(*) FROM channel_read_states WHERE channel_id = ANY($1) AND last_read_message_id IS NULL AND last_read_at > now() - interval '1 minute'`,
		[]uuid.UUID{f.channelID, second}).Scan(&n))
	assert.Equal(t, 4, n, "2 участника × 2 канала")
}
