-- +migrate Up
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS call_participant_ids UUID[] NOT NULL DEFAULT '{}';
