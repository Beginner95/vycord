package postgres_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/pkg/authtoken"
)

func shortID() string { return strings.ReplaceAll(uuid.NewString(), "-", "")[:12] }

func exec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	_, err := pool.Exec(context.Background(), sql, args...)
	require.NoError(t, err)
}

func seedUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	s := shortID()
	exec(t, pool, `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
		id, "u"+s, s+"@example.test")
	return id
}

func seedServer(t *testing.T, pool *pgxpool.Pool, ownerID uuid.UUID, guestLinksEnabled bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, pool, `INSERT INTO servers (id, name, owner_id, guest_links_enabled) VALUES ($1, $2, $3, $4)`,
		id, "srv-"+shortID(), ownerID, guestLinksEnabled)
	return id
}

func seedChannel(t *testing.T, pool *pgxpool.Pool, serverID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, pool, `INSERT INTO channels (id, server_id, name) VALUES ($1, $2, $3)`, id, serverID, "ch-"+shortID())
	return id
}

func seedOpenCall(t *testing.T, pool *pgxpool.Pool, channelID, starterID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, pool, `
		INSERT INTO messages (id, channel_id, user_id, content, kind, call_started_at, call_last_seen_at, call_participant_ids, created_at, updated_at)
		VALUES ($1, $2, $3, '', 'call', now(), now(), ARRAY[$3::uuid], now(), now())`,
		id, channelID, starterID)
	return id
}

func seedEndCall(t *testing.T, pool *pgxpool.Pool, callMessageID uuid.UUID) {
	t.Helper()
	exec(t, pool, `UPDATE messages SET call_ended_at = now() WHERE id = $1`, callMessageID)
}

func seedGuestLink(t *testing.T, pool *pgxpool.Pool, channelID, callMessageID, createdBy uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	secret, err := authtoken.GenerateOpaqueSecret()
	require.NoError(t, err)
	exec(t, pool, `
		INSERT INTO call_guest_links (id, secret_hash, channel_id, call_message_id, created_by, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, now(), $6)`,
		id, authtoken.HashOpaqueSecret(secret), channelID, callMessageID, createdBy, time.Now().Add(time.Hour))
	return id
}

func seedGuest(t *testing.T, pool *pgxpool.Pool, linkID, channelID, callMessageID uuid.UUID, status string, admitted bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	var admittedAt *time.Time
	if admitted {
		now := time.Now()
		admittedAt = &now
	}
	exec(t, pool, `
		INSERT INTO call_guests (id, link_id, channel_id, call_message_id, display_name, status, created_at, admitted_at)
		VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
		id, linkID, channelID, callMessageID, "Guest "+shortID(), status, admittedAt)
	return id
}
