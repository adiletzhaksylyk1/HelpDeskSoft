import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import crypto from 'node:crypto';
import { getEnvConfig } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import type { TicketsRepository } from '../tickets/tickets.repository.js';
import type { StorageService } from '../storage/storage.service.js';
import type { Mailbox } from '../../db/schema.js';
import { graphService, type GraphConfig } from './graph.service.js';
import { MailboxesRepository } from '../mailboxes/mailboxes.repository.js';

export interface MailboxContext {
  mailboxId?: string;
  recipientEmail?: string;
}

export class ImapWorker {
  private pollTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private activeSyncMailboxIds = new Set<string>();

  constructor(
    private readonly ticketsRepository: TicketsRepository,
    private readonly storageService?: StorageService,
    private readonly mailboxesRepository?: MailboxesRepository
  ) { }

  private createClientForConfig(config: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  }): ImapFlow {
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass.replace(/\s+/g, ''),
      },
      connectionTimeout: 25000,
      greetingTimeout: 25000,
      socketTimeout: 45000,
      logger: false,
    });


    client.on('error', (err) => {
      logger.warn({ err: err?.message || err, user: config.user }, 'IMAP client socket error (handled)');
    });

    return client;
  }

  async processIncomingMail(
    source: Buffer | string,
    context?: MailboxContext
  ): Promise<{ created: boolean; ticketId?: string; messageId: string }> {
    const parsed: ParsedMail = await simpleParser(source);
    const messageId = parsed.messageId || `<${crypto.randomUUID()}@generated.local>`;

    const existing = await this.ticketsRepository.findByMessageId(messageId);
    if (existing) {
      logger.info({ messageId }, 'Email message already processed. Skipping duplicate.');
      return { created: false, messageId, ticketId: existing.id };
    }

    // Check if this email was deleted by the user
    const wasDeleted = await this.ticketsRepository.isMessageDeleted(messageId);
    if (wasDeleted) {
      logger.info({ messageId }, 'Email message belongs to a deleted ticket. Skipping duplicate to prevent resurrection.');
      return { created: false, messageId };
    }

    // Check if this is a reply referencing a deleted ticket
    if (parsed.inReplyTo && (await this.ticketsRepository.isMessageDeleted(parsed.inReplyTo))) {
      logger.info({ messageId, inReplyTo: parsed.inReplyTo }, 'Email reply references a deleted ticket. Skipping duplicate.');
      return { created: false, messageId };
    }


    const senderEmail = parsed.from?.value[0]?.address || 'unknown@domain.com';
    let toAddress: string | undefined = undefined;
    if (parsed.to) {
      if (Array.isArray(parsed.to)) {
        toAddress = parsed.to[0]?.value?.[0]?.address;
      } else {
        toAddress = parsed.to.value?.[0]?.address;
      }
    }
    const recipientEmail = context?.recipientEmail || toAddress;
    const subject = parsed.subject || '(No Subject)';
    const body = parsed.text || (typeof parsed.html === 'string' ? parsed.html : '') || '(Empty Message Body)';

    logger.info({ messageId, senderEmail, recipientEmail, subject, mailboxId: context?.mailboxId }, 'Creating new ticket from incoming email');

    const ticket = await this.ticketsRepository.create({
      messageId,
      senderEmail,
      recipientEmail,
      mailboxId: context?.mailboxId,
      subject,
      body,
      status: 'WAITING',
      priority: 'MEDIUM',
    });

    // Save attachments to storage if available
    if (this.storageService && parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        if (att.content && att.filename) {
          try {
            await this.storageService.saveAttachment({
              ticketId: ticket.id,
              originalName: att.filename,
              mimeType: att.contentType || 'application/octet-stream',
              content: att.content,
            });
          } catch (attErr) {
            logger.error({ attErr, filename: att.filename, ticketId: ticket.id }, 'Error storing email attachment');
          }
        }
      }
    }

    logger.info({ ticketId: ticket.id, messageId, assigneeId: ticket.assigneeId, recipientEmail }, 'Ticket created and assigned successfully');

    return { created: true, ticketId: ticket.id, messageId };
  }

  async fetchAndProcessMailbox(mailbox: Mailbox): Promise<number> {
    if (mailbox.provider === 'graph') {
      return this.fetchAndProcessGraphMailbox(mailbox);
    }

    if (!mailbox.imapHost || !mailbox.imapUser || !mailbox.imapPassword) {
      logger.debug({ mailbox: mailbox.email }, 'Mailbox credentials incomplete. Skipping.');
      return 0;
    }

    if (this.activeSyncMailboxIds.has(mailbox.id)) {
      logger.info({ mailbox: mailbox.email }, 'Sync already in progress for this mailbox, skipping concurrent run');
      return 0;
    }
    this.activeSyncMailboxIds.add(mailbox.id);

    let processedCount = 0;
    const client = this.createClientForConfig({
      host: mailbox.imapHost,
      port: mailbox.imapPort,
      secure: mailbox.imapSecure,
      user: mailbox.imapUser,
      pass: mailbox.imapPassword,
    });

    try {
      await client.connect();
      logger.info({ mailbox: mailbox.email }, 'Connected to IMAP server for mailbox');

      const lock = await client.getMailboxLock('INBOX');
      try {
        // Query recent unseen emails (past 14 days) to prevent massive UID list timeouts on large mailboxes (10k+ emails)
        const sinceDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const uids = await client.search({ seen: false, since: sinceDate });

        if (uids && uids.length > 0) {
          const batchUids = uids.slice(-10);
          logger.info({ mailbox: mailbox.email, unseenTotal: uids.length, processingBatch: batchUids.length }, 'Processing incoming email batch for mailbox');

          const messages = client.fetch(batchUids, { source: true, envelope: true });
          const processedUids: number[] = [];
          for await (const msg of messages) {
            if (!msg.source) continue;
            try {
              const res = await this.processIncomingMail(msg.source, {
                mailboxId: mailbox.id,
                recipientEmail: mailbox.email,
              });
              if (res.created) {
                processedCount++;
              }
              processedUids.push(msg.uid);
            } catch (err) {
              logger.error({ err, uid: msg.uid, mailbox: mailbox.email }, 'Error processing message for mailbox');
            }
          }

          if (processedUids.length > 0) {
            try {
              await client.messageFlagsAdd(processedUids, ['\\Seen']);
            } catch (flagErr) {
              logger.warn({ flagErr, mailbox: mailbox.email }, 'Failed to set Seen flags on batch');
            }
          }

        }
      } finally {
        lock.release();
      }

      // Update sync status on success immediately
      if (this.mailboxesRepository) {
        await this.mailboxesRepository.updateSyncStatus(mailbox.id, null);
      }

      try {
        await client.logout();
      } catch {
        // Safe ignore on logout socket close
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      logger.error({ err: errMsg, mailbox: mailbox.email }, 'IMAP mailbox sync error');
      if (this.mailboxesRepository) {
        await this.mailboxesRepository.updateSyncStatus(mailbox.id, errMsg);
      }
      throw err;
    }
    finally {
      this.activeSyncMailboxIds.delete(mailbox.id);
      try {
        client.close();
      } catch {
        // Safe ignore
      }
    }

    return processedCount;
  }

  async fetchAndProcessGraphMailbox(mailbox: Mailbox): Promise<number> {
    if (!mailbox.msTenantId || !mailbox.msClientId || !mailbox.msClientSecret) {
      logger.debug({ mailbox: mailbox.email }, 'Microsoft Graph credentials incomplete. Skipping.');
      return 0;
    }

    if (this.activeSyncMailboxIds.has(mailbox.id)) {
      logger.info({ mailbox: mailbox.email }, 'Sync already in progress for this mailbox, skipping concurrent run');
      return 0;
    }
    this.activeSyncMailboxIds.add(mailbox.id);

    let processedCount = 0;
    const config: GraphConfig = {
      tenantId: mailbox.msTenantId,
      clientId: mailbox.msClientId,
      clientSecret: mailbox.msClientSecret,
      mailboxEmail: mailbox.email,
    };

    try {
      logger.info({ mailbox: mailbox.email }, 'Polling Microsoft 365 Graph inbox for unread messages');
      const messages = await graphService.fetchUnreadMessages(config, 15);

      for (const msg of messages) {
        try {
          const existing = await this.ticketsRepository.findByMessageId(msg.internetMessageId);
          if (existing) {
            await graphService.markAsRead(config, msg.id);
            continue;
          }

          const wasDeleted = await this.ticketsRepository.isMessageDeleted(msg.internetMessageId);
          if (wasDeleted) {
            await graphService.markAsRead(config, msg.id);
            continue;
          }

          const ticket = await this.ticketsRepository.create({
            messageId: msg.internetMessageId,
            senderEmail: msg.senderEmail,
            recipientEmail: mailbox.email,
            mailboxId: mailbox.id,
            subject: msg.subject,
            body: msg.bodyText || '(Empty Message Body)',
            status: 'WAITING',
            priority: 'MEDIUM',
          });

          if (this.storageService && msg.attachments && msg.attachments.length > 0) {
            for (const att of msg.attachments) {
              try {
                await this.storageService.saveAttachment({
                  ticketId: ticket.id,
                  originalName: att.filename,
                  mimeType: att.contentType,
                  content: att.content,
                });
              } catch (attErr) {
                logger.error({ attErr, filename: att.filename, ticketId: ticket.id }, 'Error storing Graph email attachment');
              }
            }
          }

          await graphService.markAsRead(config, msg.id);
          processedCount++;
          logger.info({ ticketId: ticket.id, subject: msg.subject, mailbox: mailbox.email }, 'Created ticket from Graph message');
        } catch (msgErr) {
          logger.error({ err: msgErr, messageId: msg.internetMessageId, mailbox: mailbox.email }, 'Error processing Graph message');
        }
      }

      if (this.mailboxesRepository) {
        await this.mailboxesRepository.updateSyncStatus(mailbox.id, null);
      }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      logger.error({ err: errMsg, mailbox: mailbox.email }, 'Microsoft Graph mailbox sync error');
      if (this.mailboxesRepository) {
        await this.mailboxesRepository.updateSyncStatus(mailbox.id, errMsg);
      }
      throw err;
    } finally {
      this.activeSyncMailboxIds.delete(mailbox.id);
    }

    return processedCount;
  }

  async fetchAndProcessEnv(): Promise<number> {
    const env = getEnvConfig();
    if (!env.IMAP_HOST || !env.IMAP_USER || !env.IMAP_PASSWORD || env.IMAP_HOST.includes('example.com')) {
      logger.debug('IMAP credentials not configured or set to placeholder. Skipping IMAP poll.');
      return 0;
    }

    let processedCount = 0;
    const client = this.createClientForConfig({
      host: env.IMAP_HOST,
      port: env.IMAP_PORT,
      secure: env.IMAP_SECURE,
      user: env.IMAP_USER,
      pass: env.IMAP_PASSWORD,
    });

    try {
      await client.connect();
      logger.info('Connected to default IMAP server');

      const lock = await client.getMailboxLock('INBOX');
      try {
        // Query recent unseen emails (past 14 days) to prevent massive UID list timeouts on large mailboxes (10k+ emails)
        const sinceDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
        const uids = await client.search({ seen: false, since: sinceDate });


        if (uids && uids.length > 0) {
          const batchUids = uids.slice(-10);
          logger.info({ unseenTotal: uids.length, processingBatch: batchUids.length }, 'Processing incoming email batch from default env');

          const messages = client.fetch(batchUids, { source: true, envelope: true });
          const processedUids: number[] = [];
          for await (const msg of messages) {
            if (!msg.source) continue;
            try {
              const res = await this.processIncomingMail(msg.source, {
                recipientEmail: env.IMAP_USER,
              });
              if (res.created) {
                processedCount++;
              }
              processedUids.push(msg.uid);
            } catch (err) {
              logger.error({ err, uid: msg.uid }, 'Error processing individual email message');
            }
          }

          if (processedUids.length > 0) {
            try {
              await client.messageFlagsAdd(processedUids, ['\\Seen']);
            } catch (flagErr) {
              logger.warn({ flagErr }, 'Failed to set Seen flags on batch in default env');
            }
          }


        }
      } finally {
        lock.release();
      }

      try {
        await client.logout();
      } catch {
        // Safe ignore
      }
    } catch (err) {
      logger.error({ err }, 'IMAP default worker connection/processing error');
    } finally {
      try {
        client.close();
      } catch {
        // Safe ignore
      }
    }

    return processedCount;
  }

  async fetchAndProcess(): Promise<number> {
    if (this.isProcessing) {
      logger.debug('IMAP worker already in progress, skipping tick');
      return 0;
    }

    this.isProcessing = true;
    let totalProcessed = 0;

    try {
      if (this.mailboxesRepository) {
        const activeMailboxes = await this.mailboxesRepository.findActive();
        if (activeMailboxes.length > 0) {
          for (const mailbox of activeMailboxes) {
            try {
              const count = await this.fetchAndProcessMailbox(mailbox);
              totalProcessed += count;
            } catch {
              // Mailbox error already logged and recorded in db, continue with next mailbox
            }
          }
          return totalProcessed;
        }
      }

      // Fallback to .env configuration if no database mailboxes exist
      totalProcessed = await this.fetchAndProcessEnv();
    } finally {
      this.isProcessing = false;
    }

    return totalProcessed;
  }

  start(): void {
    const env = getEnvConfig();
    logger.info({ pollIntervalMs: env.IMAP_POLL_INTERVAL_MS }, 'Starting multi-mailbox IMAP polling worker');

    // Initial run
    this.fetchAndProcess().catch((err) => logger.error({ err }, 'Initial IMAP poll failed'));

    // Recurring interval
    this.pollTimer = setInterval(() => {
      this.fetchAndProcess().catch((err) => logger.error({ err }, 'Periodic IMAP poll failed'));
    }, env.IMAP_POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('IMAP worker stopped');
  }
}
