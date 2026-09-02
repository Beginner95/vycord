-- +migrate Up
ALTER TABLE otp_codes ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE otp_codes ADD COLUMN email VARCHAR(255);

UPDATE otp_codes SET email = users.email
FROM users WHERE otp_codes.user_id = users.id;

ALTER TABLE otp_codes ALTER COLUMN email SET NOT NULL;

DROP INDEX idx_otp_codes_user_purpose;
CREATE INDEX idx_otp_codes_email ON otp_codes(email, created_at DESC);
