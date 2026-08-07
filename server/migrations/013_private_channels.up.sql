-- +migrate Up
-- Приватные каналы (Borda VYC-59): владелец канала (создатель, отдельно от
-- владельца сервера) может ограничить видимость канала списком приглашённых.
ALTER TABLE channels ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN owner_id UUID REFERENCES users(id);

-- Бэкофилл существующих каналов: владелец = владелец сервера канала.
UPDATE channels c SET owner_id = s.owner_id FROM servers s WHERE c.server_id = s.id;

ALTER TABLE channels ALTER COLUMN owner_id SET NOT NULL;

CREATE TABLE channel_members (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES users(id),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);
