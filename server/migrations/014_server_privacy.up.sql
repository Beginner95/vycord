-- +migrate Up
ALTER TABLE servers ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE invites (
    code       TEXT PRIMARY KEY,
    server_id  UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    max_uses   INTEGER,
    uses       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX invites_server_id_idx ON invites(server_id);

-- PermCreateInvite (1 << 7 = 128) — сверено с server/internal/domain/permission.go.
UPDATE roles SET permissions = permissions | 128 WHERE is_default = true;

DROP TABLE channel_members;
ALTER TABLE channels DROP COLUMN owner_id;
ALTER TABLE channels DROP COLUMN is_private;
