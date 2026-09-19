-- +migrate Down
DELETE FROM messages WHERE guest_id IS NOT NULL;
DROP INDEX IF EXISTS idx_messages_guest_id;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_guest_kind_check;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_author_check;
ALTER TABLE messages DROP COLUMN IF EXISTS guest_id;
ALTER TABLE messages ALTER COLUMN user_id SET NOT NULL;
DROP TABLE IF EXISTS call_guests;
DROP TABLE IF EXISTS call_guest_links;
ALTER TABLE servers DROP COLUMN IF EXISTS guest_links_enabled;
