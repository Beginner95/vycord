package postgres_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type callFixture struct {
	pool                                 *pgxpool.Pool
	ownerID, serverID, channelID, callID uuid.UUID
}

func newCallFixture(t *testing.T, guestLinksEnabled bool) *callFixture {
	t.Helper()
	pool := openIntegrationDB(t)
	owner := seedUser(t, pool)
	server := seedServer(t, pool, owner, guestLinksEnabled)
	channel := seedChannel(t, pool, server)
	call := seedOpenCall(t, pool, channel, owner)
	return &callFixture{pool: pool, ownerID: owner, serverID: server, channelID: channel, callID: call}
}

func execErr(pool *pgxpool.Pool, sql string, args ...any) error {
	_, err := pool.Exec(context.Background(), sql, args...)
	return err
}

// Н25
func TestMigration025_MessagesAuthorCheck(t *testing.T) {
	f := newCallFixture(t, true)
	link := seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)
	guest := seedGuest(t, f.pool, link, f.channelID, f.callID, "admitted", true)

	err := execErr(f.pool, `INSERT INTO messages (id, channel_id, user_id, guest_id, content) VALUES ($1, $2, $3, $4, 'both')`,
		uuid.New(), f.channelID, f.ownerID, guest)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "messages_author_check")

	err = execErr(f.pool, `INSERT INTO messages (id, channel_id, content) VALUES ($1, $2, 'nobody')`, uuid.New(), f.channelID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "messages_author_check")

	require.NoError(t, execErr(f.pool, `INSERT INTO messages (id, channel_id, guest_id, content) VALUES ($1, $2, $3, 'guest')`,
		uuid.New(), f.channelID, guest))
}

func TestMigration025_GuestMessageCannotBeCall(t *testing.T) {
	f := newCallFixture(t, true)
	link := seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)
	guest := seedGuest(t, f.pool, link, f.channelID, f.callID, "admitted", true)

	err := execErr(f.pool, `INSERT INTO messages (id, channel_id, guest_id, content, kind, call_started_at) VALUES ($1, $2, $3, '', 'call', now())`,
		uuid.New(), f.channelID, guest)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "messages_guest_kind_check")
}

func TestMigration025_RevokeReasonRequiredWithRevokedAt(t *testing.T) {
	f := newCallFixture(t, true)
	link := seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)

	err := execErr(f.pool, `UPDATE call_guest_links SET revoked_at = now() WHERE id = $1`, link)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "call_guest_links_revoke_check")

	require.NoError(t, execErr(f.pool, `UPDATE call_guest_links SET revoked_at = now(), revoke_reason = 'manual' WHERE id = $1`, link))
}

func TestMigration025_StatusCheck(t *testing.T) {
	f := newCallFixture(t, true)
	link := seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)
	err := execErr(f.pool, `
		INSERT INTO call_guests (id, link_id, channel_id, call_message_id, display_name, status, created_at)
		VALUES ($1, $2, $3, $4, 'x', 'vip', now())`, uuid.New(), link, f.channelID, f.callID)
	require.Error(t, err)
}

func TestMigration025_ServersDefaultDisabled(t *testing.T) {
	pool := openIntegrationDB(t)
	owner := seedUser(t, pool)
	id := uuid.New()
	require.NoError(t, execErr(pool, `INSERT INTO servers (id, name, owner_id) VALUES ($1, 'plain', $2)`, id, owner))
	var enabled bool
	require.NoError(t, pool.QueryRow(context.Background(), `SELECT guest_links_enabled FROM servers WHERE id = $1`, id).Scan(&enabled))
	assert.False(t, enabled)
}

// Н26: up → down → up on a database that already holds guest messages.
func TestMigration025_UpDownUp(t *testing.T) {
	f := newCallFixture(t, true)
	link := seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)
	guest := seedGuest(t, f.pool, link, f.channelID, f.callID, "admitted", true)
	require.NoError(t, execErr(f.pool, `INSERT INTO messages (id, channel_id, guest_id, content) VALUES ($1, $2, $3, 'hi')`,
		uuid.New(), f.channelID, guest))

	applyMigrationSection(t, f.pool, 25, "down")

	var nullable string
	require.NoError(t, f.pool.QueryRow(context.Background(),
		`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'user_id'`).Scan(&nullable))
	assert.Equal(t, "NO", nullable)
	var tables int
	require.NoError(t, f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM information_schema.tables WHERE table_name IN ('call_guests', 'call_guest_links')`).Scan(&tables))
	assert.Equal(t, 0, tables)

	applyMigrationSection(t, f.pool, 25, "up")
	seedGuestLink(t, f.pool, f.channelID, f.callID, f.ownerID)
}
