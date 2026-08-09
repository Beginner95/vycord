-- +migrate Down
ALTER TABLE messages DROP COLUMN IF EXISTS sticker_id;
DROP TABLE IF EXISTS stickers;