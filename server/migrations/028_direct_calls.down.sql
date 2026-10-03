-- +migrate Down
ALTER TABLE calls DROP COLUMN IF EXISTS accepted_at;
