-- +migrate Down
DROP INDEX idx_otp_codes_email;
CREATE INDEX idx_otp_codes_user_purpose ON otp_codes(user_id, purpose, created_at DESC);
ALTER TABLE otp_codes DROP COLUMN email;
-- Не восстанавливает NOT NULL на user_id: строки, накопленные при
-- user_id IS NULL после раскатки up, откатом не удаляются и заблокировали бы
-- этот down на NOT NULL constraint violation. down предназначен для отката
-- сразу после раскатки, пока таких строк ещё нет.
