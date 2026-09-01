-- +migrate Down
DROP TABLE IF EXISTS otp_codes;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
