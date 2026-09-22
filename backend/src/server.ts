// Helpdesk API Server
import { buildApp } from './app.js';
import { getEnvConfig } from './config/env.js';

import { getDb, closeDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { TicketsRepository } from './modules/tickets/tickets.repository.js';
import { StorageService } from './modules/storage/storage.service.js';
import { MailboxesRepository } from './modules/mailboxes/mailboxes.repository.js';
import { CleanupWorker } from './modules/cleanup/cleanup.worker.js';
import { ImapWorker } from './modules/email/imap.worker.js';
import { logger } from './shared/logger.js';

async function main(): Promise<void> {
  const env = getEnvConfig();

  logger.info('Initializing database migrations...');
  try {
    await runMigrations();
  } catch (err) {
    logger.error({ err }, 'Failed to run database migrations on startup');
    process.exit(1);
  }

  const db = getDb();
  const ticketsRepo = new TicketsRepository(db);
  const storageService = new StorageService(db);
  const mailboxesRepo = new MailboxesRepository(db);

  // Initialize and start multi-mailbox IMAP worker
  const imapWorker = new ImapWorker(ticketsRepo, storageService, mailboxesRepo);
  imapWorker.start();

  // Initialize and start 24h attachment retention cleanup worker
  const cleanupWorker = new CleanupWorker(db, storageService);
  cleanupWorker.start();

  // Build and start HTTP server
  const app = buildApp({ db, storageService, mailboxesRepo, imapWorker, enableLogging: true });

  try {
    await app.listen({ port: env.APP_PORT, host: env.APP_HOST });
    logger.info({ port: env.APP_PORT, host: env.APP_HOST }, 'Helpdesk API server listening');
  } catch (err) {
    logger.error({ err }, 'Failed to start HTTP server');
    imapWorker.stop();
    cleanupWorker.stop();
    await closeDb();
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Graceful shutdown initiated');
    imapWorker.stop();
    cleanupWorker.stop();
    await app.close();
    await closeDb();
    logger.info('Service stopped cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup failure');
  process.exit(1);
});
