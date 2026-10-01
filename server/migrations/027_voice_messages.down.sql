-- +migrate Down
DROP TABLE IF EXISTS voice_listens;
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_voice_check;
ALTER TABLE attachments
    DROP COLUMN IF EXISTS waveform,
    DROP COLUMN IF EXISTS duration_ms,
    DROP COLUMN IF EXISTS is_voice;
