-- +migrate Down
DROP INDEX IF EXISTS idx_messages_content_trgm;
