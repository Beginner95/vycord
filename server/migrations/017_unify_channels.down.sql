-- +migrate Down
-- ВНИМАНИЕ: откат необратим по данным — после него все каналы станут
-- текстовыми, информация о том, какой канал был голосовым, не восстанавливается.
ALTER TABLE channels ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'text';
