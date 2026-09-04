-- +migrate Down
ALTER TABLE users
    DROP COLUMN IF EXISTS allow_dm_from,
    DROP COLUMN IF EXISTS allow_friend_requests;
DROP TABLE IF EXISTS user_blocks;
DROP TABLE IF EXISTS friendships;
