-- +migrate Up
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

-- Backfill: на момент раскатки неподтверждённых пользователей быть не может,
-- колонка только что создана. Все существующие аккаунты считаются
-- подтверждёнными, иначе релиз заблокировал бы вход всем сразу.
UPDATE users SET email_verified_at = created_at;

CREATE TABLE otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'login')),
    code_hash BYTEA NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ
);

CREATE INDEX idx_otp_codes_user_purpose ON otp_codes(user_id, purpose, created_at DESC);
CREATE INDEX idx_otp_codes_expires ON otp_codes(expires_at);
