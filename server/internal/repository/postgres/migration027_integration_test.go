package postgres_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/repository/postgres"
)

type voiceFixture struct {
	pool                        *pgxpool.Pool
	author, listener, channelID uuid.UUID
	messageID                   uuid.UUID
}

func newVoiceFixture(t *testing.T) *voiceFixture {
	t.Helper()
	pool := openIntegrationDB(t)
	author := seedUser(t, pool)
	listener := seedUser(t, pool)
	server := seedServer(t, pool, author, false)
	channel := seedChannel(t, pool, server)
	msg := uuid.New()
	require.NoError(t, execErr(pool, `INSERT INTO messages (id, channel_id, user_id, content) VALUES ($1, $2, $3, '')`, msg, channel, author))
	return &voiceFixture{pool: pool, author: author, listener: listener, channelID: channel, messageID: msg}
}

func (f *voiceFixture) insertVoice(t *testing.T, durationMs int, waveformLen int) (uuid.UUID, error) {
	t.Helper()
	id := uuid.New()
	err := execErr(f.pool, `
		INSERT INTO attachments (id, user_id, channel_id, message_id, kind, file_name, content_type,
			size_bytes, storage_key, is_voice, duration_ms, waveform)
		VALUES ($1, $2, $3, $4, 'audio', 'voice.weba', 'audio/webm', 10, 'k', true, $5, $6)`,
		id, f.author, f.channelID, f.messageID, durationMs, make([]byte, waveformLen))
	return id, err
}

func TestMigration027_VoiceCheck(t *testing.T) {
	f := newVoiceFixture(t)

	_, err := f.insertVoice(t, 999, 64)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "attachments_voice_check")

	_, err = f.insertVoice(t, 900001, 64)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "attachments_voice_check")

	_, err = f.insertVoice(t, 5000, 63)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "attachments_voice_check")

	_, err = f.insertVoice(t, 5000, 64)
	require.NoError(t, err)
}

func TestAttachmentRepository_ListenedFor(t *testing.T) {
	f := newVoiceFixture(t)
	voiceID, err := f.insertVoice(t, 5000, 64)
	require.NoError(t, err)
	repo := postgres.NewAttachmentRepository(f.pool)

	got, err := repo.ListenedFor(f.author, []uuid.UUID{voiceID})
	require.NoError(t, err)
	assert.False(t, got[voiceID], "никто не слушал — у автора не прослушано")

	inserted, err := repo.MarkListened(voiceID, f.listener)
	require.NoError(t, err)
	assert.True(t, inserted)
	inserted, err = repo.MarkListened(voiceID, f.listener)
	require.NoError(t, err)
	assert.False(t, inserted, "повтор идемпотентен")

	got, err = repo.ListenedFor(f.author, []uuid.UUID{voiceID})
	require.NoError(t, err)
	assert.True(t, got[voiceID], "автор видит, что слушал кто-то")

	got, err = repo.ListenedFor(f.listener, []uuid.UUID{voiceID})
	require.NoError(t, err)
	assert.True(t, got[voiceID], "слушатель видит своё прослушивание")

	third := seedUser(t, f.pool)
	got, err = repo.ListenedFor(third, []uuid.UUID{voiceID})
	require.NoError(t, err)
	assert.False(t, got[voiceID], "третий ещё не слушал")

	atts, err := repo.ListByIDs([]uuid.UUID{voiceID})
	require.NoError(t, err)
	require.Len(t, atts, 1)
	assert.True(t, atts[0].IsVoice)
	require.NotNil(t, atts[0].DurationMs)
	assert.Equal(t, 5000, *atts[0].DurationMs)
	assert.Len(t, atts[0].Waveform, 64)
}
