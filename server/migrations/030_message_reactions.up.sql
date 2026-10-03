-- +migrate Up
-- VYC-106: реакции. Строка — «пользователь поставил реакцию»: ровно одно из
-- emoji / sticker_id. Удаление сообщения, пользователя или стикера уносит
-- реакции каскадом.
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    emoji      TEXT,
    sticker_id UUID REFERENCES stickers(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT message_reactions_kind_check CHECK ((emoji IS NULL) <> (sticker_id IS NULL))
);

-- «Одна и та же реакция от пользователя — не дважды». Частичные индексы:
-- NULL в обычном UNIQUE не сравнивается и дубли бы прошли.
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_reactions_emoji
    ON message_reactions (message_id, user_id, emoji) WHERE emoji IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_reactions_sticker
    ON message_reactions (message_id, user_id, sticker_id) WHERE sticker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
    ON message_reactions (message_id, created_at);
