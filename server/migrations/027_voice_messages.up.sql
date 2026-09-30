-- +migrate Up
-- VYC-101: голосовые сообщения. Голосовое — обычное вложение kind='audio'
-- с метаданными, которые считает клиент при записи: у WebM из MediaRecorder
-- duration часто Infinity, а декодировать opus/aac на сервере без cgo — новая
-- зависимость ради косметики. Сервер проверяет только диапазоны (этот CHECK
-- дублирует проверку usecase — последний рубеж).
ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS is_voice    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS duration_ms INT,
    ADD COLUMN IF NOT EXISTS waveform    BYTEA;

ALTER TABLE attachments ADD CONSTRAINT attachments_voice_check CHECK (
    NOT is_voice OR (
        kind = 'audio'
        AND duration_ms IS NOT NULL
        AND duration_ms BETWEEN 1000 AND 900000
        AND waveform IS NOT NULL
        AND octet_length(waveform) = 64
    )
);

-- Кто начинал воспроизведение голосового. Прослушивание автором не пишется
-- (usecase отсекает), поэтому «есть строка» для автора означает «слушал кто-то другой».
CREATE TABLE IF NOT EXISTS voice_listens (
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (attachment_id, user_id)
);
