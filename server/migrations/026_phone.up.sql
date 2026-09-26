-- +migrate Up
-- Номер телефона (VYC-97): только зашифрованный. phone_index — детерминированный
-- поисковый ключ (HMAC-SHA256), phone_cipher — AES-256-GCM значение.
-- Открытым текстом номер не хранится никогда.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_index TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_cipher TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_search_by_phone BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
