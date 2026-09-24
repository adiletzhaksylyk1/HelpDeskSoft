// Forward-only migration. Existing roles are preserved and normalized into the
// catalog before the foreign key is installed. No administrator is seeded.
export const HARDENING_SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_expires_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
UPDATE tickets SET resolved_at = updated_at WHERE status = 'RESOLVED' AND resolved_at IS NULL;
ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;
ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'received';
ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS delivery_error TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS replies_message_id_idx ON ticket_replies(message_id);
ALTER TABLE ticket_attachments ADD COLUMN IF NOT EXISTS reply_id UUID REFERENCES ticket_replies(id) ON DELETE CASCADE;
ALTER TABLE ticket_attachments ADD COLUMN IF NOT EXISTS ingest_key TEXT UNIQUE;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS sync_cursor TEXT;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS uid_validity TEXT;
CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id UUID NOT NULL UNIQUE REFERENCES ticket_replies(id) ON DELETE CASCADE,
  mailbox_id UUID REFERENCES mailboxes(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_status_idx ON email_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS tickets_queue_idx ON tickets(status, created_at, id);
CREATE INDEX IF NOT EXISTS tickets_assignment_idx ON tickets(assignee_id, status);
CREATE INDEX IF NOT EXISTS tickets_retention_idx ON tickets(status, resolved_at);
CREATE TABLE IF NOT EXISTS worker_leases (
  name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_attempts (
  email_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, window_start TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS mailbox_roles (
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (mailbox_id, role_id)
);
`;
