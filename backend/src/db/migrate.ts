import pg from 'pg';
import { getEnvConfig } from '../config/env.js';
import { logger } from '../shared/logger.js';

const { Pool } = pg;

export const INIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_name_idx ON roles(name);

INSERT INTO roles (id, name, description, is_admin, is_system)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin', 'System Administrator (Full access & settings)', true, true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (id, name, description, is_admin, is_system)
VALUES ('00000000-0000-0000-0000-000000000002', 'HelpDesk', 'General Support HelpDesk', false, false)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'HelpDesk',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_is_active_idx ON users(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'imap',
  ms_tenant_id TEXT,
  ms_client_id TEXT,
  ms_client_secret TEXT,
  imap_host TEXT NOT NULL DEFAULT '',
  imap_port INTEGER NOT NULL DEFAULT 993,
  imap_user TEXT NOT NULL DEFAULT '',
  imap_password TEXT NOT NULL DEFAULT '',
  imap_secure BOOLEAN NOT NULL DEFAULT true,
  smtp_host TEXT NOT NULL DEFAULT '',
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_user TEXT NOT NULL DEFAULT '',
  smtp_password TEXT NOT NULL DEFAULT '',
  smtp_secure BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  target_role TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_email_idx ON mailboxes(email);
CREATE INDEX IF NOT EXISTS mailboxes_is_active_idx ON mailboxes(is_active);

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL UNIQUE,
  sender_email TEXT NOT NULL,
  recipient_email TEXT,
  mailbox_id UUID REFERENCES mailboxes(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tickets_message_id_idx ON tickets(message_id);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_priority_idx ON tickets(priority);
CREATE INDEX IF NOT EXISTS tickets_assignee_id_idx ON tickets(assignee_id);
CREATE INDEX IF NOT EXISTS tickets_created_at_idx ON tickets(created_at);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id UUID,
  author_name TEXT,
  message_id TEXT,
  body TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS replies_ticket_id_idx ON ticket_replies(ticket_id);
CREATE INDEX IF NOT EXISTS replies_created_at_idx ON ticket_replies(created_at);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  is_purged BOOLEAN NOT NULL DEFAULT false,
  purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attachments_ticket_id_idx ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS attachments_is_purged_idx ON ticket_attachments(is_purged);

CREATE TABLE IF NOT EXISTS deleted_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID,
  message_id TEXT NOT NULL UNIQUE,
  subject TEXT,
  sender_email TEXT,
  mailbox_id UUID,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS deleted_tickets_message_id_idx ON deleted_tickets(message_id);
CREATE INDEX IF NOT EXISTS deleted_tickets_mailbox_id_idx ON deleted_tickets(mailbox_id);
`;


export async function runMigrations(clientOrPool?: pg.Client | pg.Pool): Promise<void> {
  let poolToClose: pg.Pool | null = null;
  let target = clientOrPool;

  if (!target) {
    const env = getEnvConfig();
    const url = new URL(env.DATABASE_URL);
    const targetDbName = url.pathname.replace(/^\//, '') || 'helpdesk';

    // First connect to default 'postgres' database to ensure target database exists
    const adminUrl = new URL(env.DATABASE_URL);
    adminUrl.pathname = '/postgres';

    const adminPool = new Pool({ connectionString: adminUrl.toString() });
    try {
      const checkRes = await adminPool.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [targetDbName]
      );
      if (checkRes.rows.length === 0) {
        logger.info({ targetDbName }, `Database '${targetDbName}' does not exist. Creating...`);
        // Identifier cannot be parameterized in CREATE DATABASE
        await adminPool.query(`CREATE DATABASE "${targetDbName}"`);
        logger.info({ targetDbName }, `Database '${targetDbName}' created successfully.`);
      }
    } catch (adminErr: any) {
      // If unable to connect to 'postgres' db or already exists, log and proceed
      logger.debug({ err: adminErr }, 'Database existence check skipped or failed, proceeding to direct connect');
    } finally {
      await adminPool.end().catch(() => { });
    }

    poolToClose = new Pool({ connectionString: env.DATABASE_URL });
    target = poolToClose;
  }

  try {
    logger.info('Running database migrations...');
    await target.query(INIT_SCHEMA_SQL);
    await target.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
    await target.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES mailboxes(id) ON DELETE SET NULL;`);
    await target.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS recipient_email TEXT;`);
    await target.query(`CREATE INDEX IF NOT EXISTS tickets_mailbox_id_idx ON tickets(mailbox_id);`);
    await target.query(`CREATE INDEX IF NOT EXISTS tickets_recipient_email_idx ON tickets(recipient_email);`);
    await target.query(`ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'imap';`);
    await target.query(`ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS ms_tenant_id TEXT;`);
    await target.query(`ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS ms_client_id TEXT;`);
    await target.query(`ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS ms_client_secret TEXT;`);
    await target.query(`ALTER TABLE mailboxes ALTER COLUMN imap_host DROP NOT NULL;`);
    await target.query(`ALTER TABLE mailboxes ALTER COLUMN imap_password DROP NOT NULL;`);
    await target.query(`ALTER TABLE mailboxes ALTER COLUMN imap_user DROP NOT NULL;`);
    await target.query(`ALTER TABLE mailboxes ALTER COLUMN smtp_host DROP NOT NULL;`);
    await target.query(`ALTER TABLE mailboxes ALTER COLUMN smtp_password DROP NOT NULL;`);
    await target.query(`ALTER TABLE mailboxes ALTER COLUMN smtp_user DROP NOT NULL;`);
    await target.query(`CREATE INDEX IF NOT EXISTS mailboxes_provider_idx ON mailboxes(provider);`);
    await target.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        is_admin BOOLEAN NOT NULL DEFAULT false,
        is_system BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await target.query(`CREATE UNIQUE INDEX IF NOT EXISTS roles_name_idx ON roles(name);`);
    await target.query(`
      INSERT INTO roles (id, name, description, is_admin, is_system)
      VALUES ('00000000-0000-0000-0000-000000000001', 'admin', 'System Administrator (Full access & settings)', true, true)
      ON CONFLICT (name) DO NOTHING;
    `);
    await target.query(`
      INSERT INTO roles (id, name, description, is_admin, is_system)
      VALUES ('00000000-0000-0000-0000-000000000002', 'HelpDesk', 'General Support HelpDesk', false, false)
      ON CONFLICT (name) DO NOTHING;
    `);
    await target.query(`UPDATE roles SET is_system = false WHERE name != 'admin';`);
    await target.query(`
      INSERT INTO roles (name, description, is_admin, is_system)
      SELECT DISTINCT role, 'Department / Role', false, false
      FROM users
      WHERE role NOT IN ('admin')
      ON CONFLICT (name) DO NOTHING;
    `);
    await target.query(`
      CREATE TABLE IF NOT EXISTS deleted_tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID,
        message_id TEXT NOT NULL UNIQUE,
        subject TEXT,
        sender_email TEXT,
        mailbox_id UUID,
        deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await target.query(`CREATE UNIQUE INDEX IF NOT EXISTS deleted_tickets_message_id_idx ON deleted_tickets(message_id);`);
    await target.query(`ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS target_role TEXT;`);
    await target.query(`ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS author_id UUID;`);
    await target.query(`ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS author_name TEXT;`);
    await target.query(`CREATE INDEX IF NOT EXISTS replies_author_id_idx ON ticket_replies(author_id);`);
    await target.query(`
      INSERT INTO users (name, email, role, is_active)
      VALUES ('Admin', 'admin@helpdesk.local', 'admin', true)
      ON CONFLICT (email) DO NOTHING;
    `);

    // Seed default mailbox from .env only if configured AND mailboxes table is completely empty
    const env = getEnvConfig();
    if (env.IMAP_HOST && env.IMAP_USER && !env.IMAP_HOST.includes('example.com')) {
      const existingMailboxes = await target.query('SELECT COUNT(*) as count FROM mailboxes;');
      const count = parseInt(existingMailboxes.rows?.[0]?.count || '0', 10);
      if (count === 0) {
        const imapPass = env.IMAP_PASSWORD || '';
        const smtpPass = env.SMTP_PASSWORD || imapPass;
        await target.query(`
          INSERT INTO mailboxes (
            name, email,
            imap_host, imap_port, imap_user, imap_password, imap_secure,
            smtp_host, smtp_port, smtp_user, smtp_password, smtp_secure,
            is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
          ON CONFLICT (email) DO NOTHING;
        `, [
          'Primary Support',
          env.IMAP_USER,
          env.IMAP_HOST,
          env.IMAP_PORT,
          env.IMAP_USER,
          imapPass,
          env.IMAP_SECURE,
          env.SMTP_HOST || 'smtp.gmail.com',
          env.SMTP_PORT || 587,
          env.SMTP_USER || env.IMAP_USER,
          smtpPass,
          env.SMTP_SECURE || false,
        ]);
      }
    }
    logger.info('Database migrations applied successfully.');
  } finally {
    if (poolToClose) {
      await poolToClose.end();
    }
  }
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      process.exit(1);
    });
}
