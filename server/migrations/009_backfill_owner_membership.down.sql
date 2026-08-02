-- +migrate Down
DELETE FROM server_members sm
USING servers s
WHERE s.id = sm.server_id AND s.owner_id = sm.user_id
