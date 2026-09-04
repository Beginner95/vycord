-- +migrate Down
ALTER TABLE users DROP COLUMN IF EXISTS show_last_seen;
ALTER TABLE users DROP COLUMN IF EXISTS last_seen_at;
