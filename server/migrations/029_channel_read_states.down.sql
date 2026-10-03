-- +migrate Down
DROP INDEX IF EXISTS idx_messages_channel_created;
DROP TABLE IF EXISTS channel_read_states;
