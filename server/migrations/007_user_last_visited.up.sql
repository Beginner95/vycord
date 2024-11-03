-- +migrate Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_server_id UUID REFERENCES servers(id) ON DELETE SET NULL;

CREATE INDEX idx_users_last_channel ON users(last_channel_id);
CREATE INDEX idx_users_last_server ON users(last_server_id);

-- +migrate Down
ALTER TABLE users DROP COLUMN IF EXISTS last_channel_id;
ALTER TABLE users DROP COLUMN IF EXISTS last_server_id;
