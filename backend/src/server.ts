import { sql } from "drizzle-orm";
import { buildApp } from "./app.js";
import { getEnvConfig } from "./config/env.js";
import { getDb, closeDb } from "./db/index.js";
import { TicketsRepository } from "./modules/tickets/tickets.repository.js";
import { StorageService } from "./modules/storage/storage.service.js";
import { MailboxesRepository } from "./modules/mailboxes/mailboxes.repository.js";
import { SmtpService } from "./modules/email/smtp.service.js";
import { CleanupWorker } from "./modules/cleanup/cleanup.worker.js";
import { ImapWorker } from "./modules/email/imap.worker.js";
import { OutboxWorker } from "./modules/email/outbox.worker.js";
import { logger } from "./shared/logger.js";
async function main(): Promise<void> {
  const env = getEnvConfig(),
    db = getDb();
  const schema = await db.execute(
    sql`SELECT version FROM schema_migrations WHERE version=3`,
  );
  if (!schema.rows.length)
    throw new Error("Run db:migrate before starting the application");
  const tickets = new TicketsRepository(db),
    storage = new StorageService(db),
    mailboxes = new MailboxesRepository(db),
    smtp = new SmtpService(mailboxes);
  const merged = await tickets.reconcileReplyTickets();
  if (merged) logger.info({ merged }, "Merged existing reply tickets into conversations");
  const inbox = new ImapWorker(tickets, storage, mailboxes),
    cleanup = new CleanupWorker(db, storage),
    outbox = new OutboxWorker(db, smtp, storage);
  const app = buildApp({
    db,
    storageService: storage,
    mailboxesRepo: mailboxes,
    imapWorker: inbox,
    smtpService: smtp,
    enableLogging: true,
  });
  await app.listen({ port: env.APP_PORT, host: env.APP_HOST });
  inbox.start();
  cleanup.start();
  outbox.start();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => {
      logger.fatal("Shutdown deadline exceeded");
      process.exit(1);
    }, 90000);
    deadline.unref();
    await app.close();
    await Promise.all([inbox.stop(), cleanup.stop(), outbox.stop()]);
    await closeDb();
    clearTimeout(deadline);
  };
  process.on(
    "SIGTERM",
    () =>
      void shutdown().catch((err) => {
        logger.fatal({ err }, "Shutdown failed");
        process.exit(1);
      }),
  );
  process.on(
    "SIGINT",
    () =>
      void shutdown().catch((err) => {
        logger.fatal({ err }, "Shutdown failed");
        process.exit(1);
      }),
  );
}
main().catch(async (err) => {
  logger.fatal({ err }, "Startup failed");
  await closeDb();
  process.exit(1);
});
