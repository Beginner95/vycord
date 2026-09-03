-- +migrate Down
DROP INDEX IF EXISTS idx_messages_active_call;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_call_fields_check;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE messages
    DROP COLUMN IF EXISTS call_last_seen_at,
    DROP COLUMN IF EXISTS call_ended_at,
    DROP COLUMN IF EXISTS call_started_at,
    DROP COLUMN IF EXISTS kind;
