-- +migrate Up
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS kind              TEXT NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS call_started_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS call_ended_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS call_last_seen_at TIMESTAMPTZ;

ALTER TABLE messages ADD CONSTRAINT messages_kind_check
    CHECK (kind IN ('user','call'));

-- call-строка обязана иметь начало. обычная не несёт ни одного call-поля.
ALTER TABLE messages ADD CONSTRAINT messages_call_fields_check CHECK (
    (kind = 'call' AND call_started_at IS NOT NULL)
 OR (kind = 'user' AND call_started_at IS NULL
                   AND call_ended_at IS NULL
                   AND call_last_seen_at IS NULL)
);

-- «в канале не может быть двух незакрытых звонков» — инвариант держит база.
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_active_call
    ON messages (channel_id) WHERE kind = 'call' AND call_ended_at IS NULL;
