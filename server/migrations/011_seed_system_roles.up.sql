-- +migrate Up
-- @everyone: VIEW_CHANNELS (16) | SEND_MESSAGES (32) = 48 — ровно текущие
-- возможности участника: видеть каналы, читать и писать сообщения.
INSERT INTO roles (server_id, name, color, position, permissions, is_default)
SELECT s.id, '@everyone', 0, 0, 48, TRUE
FROM servers s;

-- Administrator создаём только там, где реально есть админы.
-- MENTION_EVERYONE (64) — единственное, что админ умеет сегодня и не умеет
-- участник. Настройки сервера и каналы сейчас доступны только владельцу,
-- поэтому бит ADMINISTRATOR здесь не выдаём: это была бы эскалация прав
-- существующим пользователям, а не миграция.
INSERT INTO roles (server_id, name, color, position, permissions, is_default)
SELECT DISTINCT sm.server_id, 'Administrator', 0, 1, 64, FALSE
FROM server_members sm
WHERE sm.role = 'admin';

INSERT INTO member_roles (server_id, user_id, role_id)
SELECT sm.server_id, sm.user_id, r.id
FROM server_members sm
JOIN roles r ON r.server_id = sm.server_id AND r.name = 'Administrator' AND r.is_default = FALSE
WHERE sm.role = 'admin'
ON CONFLICT DO NOTHING
