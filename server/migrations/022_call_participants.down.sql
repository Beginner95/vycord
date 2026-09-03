-- +migrate Down
ALTER TABLE messages
    DROP COLUMN IF EXISTS call_participant_ids;
