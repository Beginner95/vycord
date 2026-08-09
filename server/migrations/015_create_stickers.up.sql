-- +migrate Up
CREATE TABLE IF NOT EXISTS stickers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id  UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    image_url  TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stickers_server_id ON stickers(server_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES stickers(id) ON DELETE CASCADE;
-- +migrate Down
ALTER TABLE messages DROP COLUMN IF EXISTS sticker_id;
DROP TABLE IF EXISTS stickers;