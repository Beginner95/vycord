-- +migrate Down
DROP INDEX IF EXISTS idx_users_last_channel;
DROP INDEX IF EXISTS idx_users_last_server;
ALTER TABLE users DROP COLUMN IF EXISTS last_channel_id;
ALTER TABLE users DROP COLUMN IF EXISTS last_server_id;
