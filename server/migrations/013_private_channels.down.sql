-- +migrate Down
DROP TABLE IF EXISTS channel_members;
ALTER TABLE channels DROP COLUMN IF EXISTS owner_id;
ALTER TABLE channels DROP COLUMN IF EXISTS is_private;
