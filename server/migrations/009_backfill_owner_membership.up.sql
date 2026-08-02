-- +migrate Up
-- Владелец до сих пор не хранился в server_members: его строка синтезировалась
-- UNION-ом в GetMembersWithUsers. Для member_roles (FK на server_members) и для
-- роли @everyone модель участников должна быть однородной.
INSERT INTO server_members (server_id, user_id, role, joined_at)
SELECT s.id, s.owner_id, 'owner', s.created_at
FROM servers s
ON CONFLICT (server_id, user_id) DO NOTHING
