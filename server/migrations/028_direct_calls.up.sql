-- +migrate Up
-- VYC-103: звонки 1:1 через SFU. Звонки, висящие с эпохи P2P, закрываются:
-- новые таймеры живут в памяти API и про них не знают.
UPDATE calls SET status = 'missed', ended_at = NOW() WHERE status = 'ringing';
UPDATE calls SET status = 'ended',  ended_at = NOW() WHERE status = 'active';
-- Момент ответа — для длительности звонка в будущих личках (VYC-91).
ALTER TABLE calls ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
