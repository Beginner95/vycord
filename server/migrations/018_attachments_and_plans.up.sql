-- +migrate Up
-- VYC-82: вложения в сообщениях + тарифные планы.
--
-- Ключ plans — натуральный (code), а не UUID: только так у users.plan_code
-- работает DEFAULT 'free'. С UUID-ключом дефолт потребовал бы подзапроса,
-- который Postgres в DEFAULT не пускает, и пришлось бы менять регистрацию.
CREATE TABLE IF NOT EXISTS plans (
    code            TEXT PRIMARY KEY,
    max_file_bytes  BIGINT NOT NULL,
    retention_days  INT,
    max_total_bytes BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (code, max_file_bytes, retention_days, max_total_bytes)
VALUES ('free', 26214400, NULL, NULL)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS plan_code TEXT NOT NULL DEFAULT 'free' REFERENCES plans(code);

CREATE TABLE IF NOT EXISTS attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id   UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id   UUID REFERENCES messages(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
    file_name    TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    storage_key  TEXT NOT NULL,
    thumb_key    TEXT,
    width        INT,
    height       INT,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_orphans    ON attachments(created_at) WHERE message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_expiring   ON attachments(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_user_id    ON attachments(user_id);

-- Колонка заведена в миграции 005, ни одним кодовым путём не заполняется и
-- хранит только строки-URL — места под имя, размер и MIME в ней нет.
ALTER TABLE messages DROP COLUMN IF EXISTS attachments;
