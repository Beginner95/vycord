-- +migrate Up
-- Гостевой вход в звонок по ссылке: docs/superpowers/specs/2026-09-17-guest-call-link-design.md
ALTER TABLE servers
    ADD COLUMN IF NOT EXISTS guest_links_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS call_guest_links (
    id              UUID PRIMARY KEY,
    secret_hash     BYTEA NOT NULL UNIQUE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    call_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    uses            INT NOT NULL DEFAULT 0,
    closed_at       TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    revoked_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    revoke_reason   TEXT,
    CONSTRAINT call_guest_links_revoke_check CHECK (
        (revoked_at IS NULL AND revoke_reason IS NULL)
     OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL
         AND revoke_reason IN ('manual', 'call_ended', 'server_disabled'))
    )
);
CREATE INDEX IF NOT EXISTS idx_call_guest_links_call ON call_guest_links (call_message_id);
CREATE INDEX IF NOT EXISTS idx_call_guest_links_unrevoked ON call_guest_links (call_message_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS call_guests (
    id              UUID PRIMARY KEY,
    link_id         UUID NOT NULL REFERENCES call_guest_links(id) ON DELETE CASCADE,
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    call_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    display_name    TEXT NOT NULL,
    session_hash    BYTEA UNIQUE,
    ip_hash         BYTEA,
    status          TEXT NOT NULL CHECK (status IN
        ('lobby', 'admitted', 'rejected', 'lobby_timeout', 'left', 'kicked', 'revoked', 'call_ended')),
    banned          BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL,
    decided_at      TIMESTAMPTZ,
    decided_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    admitted_at     TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    ended_by        UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_call_guests_call_status ON call_guests (call_message_id, status);
CREATE INDEX IF NOT EXISTS idx_call_guests_link_status ON call_guests (link_id, status);
CREATE INDEX IF NOT EXISTS idx_call_guests_active ON call_guests (call_message_id) WHERE status IN ('lobby', 'admitted');
CREATE INDEX IF NOT EXISTS idx_call_guests_ip_hash ON call_guests (call_message_id, ip_hash) WHERE ip_hash IS NOT NULL;

ALTER TABLE messages ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS guest_id UUID REFERENCES call_guests(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_author_check
    CHECK ((user_id IS NULL) <> (guest_id IS NULL));
ALTER TABLE messages ADD CONSTRAINT messages_guest_kind_check
    CHECK (guest_id IS NULL OR kind = 'user');
CREATE INDEX IF NOT EXISTS idx_messages_guest_id ON messages (guest_id) WHERE guest_id IS NOT NULL;
