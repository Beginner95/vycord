-- +migrate Down
ALTER TABLE users
    DROP COLUMN IF EXISTS phone_index,
    DROP COLUMN IF EXISTS phone_cipher,
    DROP COLUMN IF EXISTS allow_search_by_phone,
    DROP COLUMN IF EXISTS phone_verified_at;
