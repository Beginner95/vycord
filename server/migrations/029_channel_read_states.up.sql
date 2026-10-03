-- +migrate Up
-- VYC-104: курсор прочтения. Строка значит «пользователь прочитал канал до
-- (last_read_at, last_read_message_id)» в порядке (created_at, id). И счётчики
-- непрочитанного, и квитанции считаются от неё — поштучных отметок нет.
-- last_read_message_id без FK: удаление сообщения не должно ни ронять, ни
-- откатывать курсор. NULL в нём значит «прочитано всё с created_at <= last_read_at».
CREATE TABLE IF NOT EXISTS channel_read_states (
    user_id              UUID NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    channel_id           UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_at         TIMESTAMPTZ NOT NULL,
    last_read_message_id UUID,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_read_states_channel
    ON channel_read_states (channel_id, last_read_at);

-- Подсчёт непрочитанного идёт диапазоном по (channel_id, created_at) —
-- без этого индекса каждый счётчик сканировал бы весь канал.
CREATE INDEX IF NOT EXISTS idx_messages_channel_created
    ON messages (channel_id, created_at);

-- Всё, что было до деплоя, считается прочитанным: иначе у каждого участника
-- разом стала бы непрочитанной вся история.
INSERT INTO channel_read_states (user_id, channel_id, last_read_at)
SELECT sm.user_id, c.id, now()
FROM server_members sm
JOIN channels c ON c.server_id = sm.server_id
ON CONFLICT (user_id, channel_id) DO NOTHING;
