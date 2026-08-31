-- +migrate Down
-- Колонка возвращается пустой: восстанавливать в неё нечего, она никогда не
-- заполнялась.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments TEXT[];

DROP TABLE IF EXISTS attachments;

ALTER TABLE users DROP COLUMN IF EXISTS plan_code;

DROP TABLE IF EXISTS plans;
