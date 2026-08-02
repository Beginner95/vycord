-- +migrate Up
-- docker-compose.prod.yml ждёт migrate через service_completed_successfully
-- только для НОВОГО контейнера api. Старый контейнер api продолжает
-- обслуживать трафик на уже обновлённой схеме, пока compose его не
-- пересоздаст. В этом окне деплоя CreateServer старого бинаря не пишет ни
-- владельца в server_members, ни роль @everyone — тот же битый инвариант,
-- что чинят миграции 009 и 011, но по расписанию, а не по сбою.
-- Повторяем оба бэкфилла идемпотентно для серверов, попавших в это окно.

INSERT INTO server_members (server_id, user_id, role, joined_at)
SELECT s.id, s.owner_id, 'owner', s.created_at
FROM servers s
ON CONFLICT (server_id, user_id) DO NOTHING;

-- VIEW_CHANNELS (16) | SEND_MESSAGES (32) = 48, как в 011 — сверено с
-- server/internal/domain/permission.go.
INSERT INTO roles (server_id, name, color, position, permissions, is_default)
SELECT s.id, '@everyone', 0, 0, 48, TRUE
FROM servers s
WHERE NOT EXISTS (
    SELECT 1 FROM roles r WHERE r.server_id = s.id AND r.is_default = TRUE
);
