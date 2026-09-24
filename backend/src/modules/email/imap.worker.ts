import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import crypto from "node:crypto";
import { getEnvConfig } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { withDbLock } from "../../db/lock.js";
import { withLease } from "../../db/lease.js";
import { TicketsRepository } from "../tickets/tickets.repository.js";
import type { StorageService } from "../storage/storage.service.js";
import type { Mailbox } from "../../db/schema.js";
import {
  graphService,
  GraphHttpError,
  type GraphConfig,
} from "./graph.service.js";
import type { MailboxesRepository } from "../mailboxes/mailboxes.repository.js";
export interface MailboxContext {
  mailboxId?: string;
  recipientEmail?: string;
  providerMessageId?: string;
}
export class ImapWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private jobs = new Set<Promise<number>>();
  private stopped = false;
  constructor(
    private ticketsRepository: TicketsRepository,
    private storageService?: StorageService,
    private mailboxesRepository?: MailboxesRepository,
  ) {}
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
      doSTARTTLS: !config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      logger: false,
    });
    client.on("error", (error) =>
      logger.warn({ message: error.message }, "IMAP connection error"),
    );
    return client;
  }
  async processIncomingMail(
    source: Buffer | string,
    context?: MailboxContext,
  ): Promise<{ created: boolean; ticketId?: string; messageId: string }> {
    if (Buffer.byteLength(source) > getEnvConfig().MAX_MESSAGE_BYTES)
      throw new Error("Message exceeds size limit");
    const parsed = await simpleParser(source);
    const messageId =
      parsed.messageId ||
      "<sha256-" +
        crypto.createHash("sha256").update(source).digest("hex") +
        "@ingest>";
    const sender = parsed.from?.value[0]?.address?.toLowerCase();
    if (!sender) throw new Error("Message has no valid sender");
    const refs = [
      ...(Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : []),
      ...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
    ];
    const attachments = parsed.attachments || [];
    if (
      attachments.length > 20 ||
      attachments.reduce((n, a) => n + a.size, 0) >
        getEnvConfig().MAX_MESSAGE_BYTES
    )
      throw new Error("Attachment limits exceeded");
    return withDbLock(this.ticketsRepository.db, 740010, async (tx) => {
      const repo = new TicketsRepository(tx);
      const existing = await repo.findByMessageId(messageId),
        existingReply = await repo.findReplyByMessageId(messageId);
      if (existing || existingReply)
        return {
          created: false,
          messageId,
          ticketId: existing?.id || existingReply?.ticketId,
        };
      if (await repo.isMessageDeleted(messageId))
        return { created: false, messageId };
      for (const ref of refs.slice(-50))
        if (await repo.isMessageDeleted(ref))
          return { created: false, messageId };
      let ticket = await repo.findThread(refs, context?.mailboxId);
      // A matching Message-ID is not authority to append as a different customer.
      if (ticket && ticket.senderEmail.toLowerCase() !== sender) ticket = null;
      const body = parsed.text || "(Message contains no plain text body)";
      let replyId: string | undefined;
      if (ticket) {
        const reply = await repo.createReply({
          ticketId: ticket.id,
          body,
          senderType: "CUSTOMER",
          messageId,
          providerMessageId: context?.providerMessageId,
          deliveryStatus: "received",
        });
        replyId = reply.id;
        await repo.update(ticket.id, { status: "WAITING" });
      } else {
        const to = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to;
        ticket = await repo.create(
          {
            messageId,
            senderEmail: sender,
            recipientEmail: context?.recipientEmail || to?.value[0]?.address,
            mailboxId: context?.mailboxId,
            providerMessageId: context?.providerMessageId,
            subject: parsed.subject || "(No subject)",
            body,
            status: "WAITING",
            priority: "MEDIUM",
          },
          tx,
        );
      }
      if (attachments.length && !this.storageService)
        throw new Error("Attachment storage unavailable");
      for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        await this.storageService!.withDb(tx).saveAttachment({
          ticketId: ticket.id,
          replyId,
          ingestKey: "mail:" + messageId + ":" + i,
          originalName: a.filename || "attachment-" + i,
          mimeType: a.contentType,
          content: a.content,
        });
      }
      return { created: true, messageId, ticketId: ticket.id };
    });
  }
  async fetchAndProcessMailbox(mailbox: Mailbox): Promise<number> {
    if (!mailbox.isActive || this.stopped) return 0;
    const job = (async () => {
      const count = await withLease(
        this.ticketsRepository.db,
        "mailbox:" + mailbox.id,
        async () => {
          try {
            const count =
              mailbox.provider === "graph"
                ? await this.fetchAndProcessGraphMailbox(mailbox)
                : await this.syncImap(mailbox);
            await this.mailboxesRepository?.updateSyncStatus(mailbox.id, null);
            return count;
          } catch (error: any) {
            await this.mailboxesRepository?.updateSyncStatus(
              mailbox.id,
              String(error.message).slice(0, 300),
            );
            throw error;
          }
        },
      );
      return count || 0;
    })();
    this.jobs.add(job);
    try {
      return await job;
    } finally {
      this.jobs.delete(job);
    }
  }
  private async syncImap(mailbox: Mailbox): Promise<number> {
    if (!mailbox.imapHost || !mailbox.imapUser || !mailbox.imapPassword)
      throw new Error("Incomplete IMAP credentials");
    const client = this.createClientForConfig({
      host: mailbox.imapHost,
      port: mailbox.imapPort,
      secure: mailbox.imapSecure,
      user: mailbox.imapUser,
      pass: mailbox.imapPassword,
    });
    let count = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const validity = String(client.mailbox && client.mailbox.uidValidity);
        let last =
          mailbox.uidValidity === validity
            ? Number(mailbox.syncCursor || 0)
            : 0;
        const uidNext = client.mailbox ? client.mailbox.uidNext : 1;
        const upper = Math.min(last + 1000, uidNext - 1);
        if (upper <= last) return 0;
        const found = await client.search(
          { uid: last + 1 + ":" + upper },
          { uid: true },
        );
        const batch = (found || [])
          .filter((uid) => uid > last)
          .sort((a, b) => a - b)
          .slice(0, 10);
        for (const uid of batch) {
          if (this.stopped) break;
          const meta = await client.fetchOne(
            String(uid),
            { size: true },
            { uid: true },
          );
          if (!meta) continue;
          if ((meta.size || 0) > getEnvConfig().MAX_MESSAGE_BYTES)
            throw new Error(
              "Oversized message UID " + uid + " requires operator review",
            );
          const message = await client.fetchOne(
            String(uid),
            { source: true },
            { uid: true },
          );
          if (!message || !message.source)
            throw new Error("Message disappeared before ingestion");
          const result = await this.processIncomingMail(message.source, {
            mailboxId: mailbox.id,
            recipientEmail: mailbox.email,
          });
          if (result.created) count++;
          last = uid;
          // Checkpoint the durable record before changing the mailbox read flag.
          await this.mailboxesRepository?.update(mailbox.id, {
            syncCursor: String(last),
            uidValidity: validity,
          });
          await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
        }
        if (!batch.length)
          await this.mailboxesRepository?.update(mailbox.id, {
            syncCursor: String(upper),
            uidValidity: validity,
          });
      } finally {
        lock.release();
      }
      await client.logout();
    } finally {
      client.close();
    }
    return count;
  }
  async fetchAndProcessGraphMailbox(mailbox: Mailbox): Promise<number> {
    if (!mailbox.msTenantId || !mailbox.msClientId || !mailbox.msClientSecret)
      throw new Error("Incomplete Microsoft credentials");
    const config: GraphConfig = {
      tenantId: mailbox.msTenantId,
      clientId: mailbox.msClientId,
      clientSecret: mailbox.msClientSecret,
      mailboxEmail: mailbox.email,
    };
    let page;
    try {
      page = await graphService.fetchPage(config, mailbox.syncCursor);
    } catch (error) {
      if (error instanceof GraphHttpError && error.status === 410) {
        await this.mailboxesRepository?.update(mailbox.id, {
          syncCursor: null,
        });
        return 0;
      }
      throw error;
    }
    let count = 0;
    for (const id of page.ids) {
      if (this.stopped) return count;
      let raw: Buffer;
      try {
        raw = await graphService.getMime(config, id);
      } catch (error) {
        if (error instanceof GraphHttpError && error.status === 404) continue;
        throw error;
      }
      const result = await this.processIncomingMail(raw, {
        mailboxId: mailbox.id,
        recipientEmail: mailbox.email,
        providerMessageId: id,
      });
      if (result.created) count++;
    }
    await this.mailboxesRepository?.update(mailbox.id, {
      syncCursor: page.cursor,
    });
    return count;
  }
  async fetchAndProcess(): Promise<number> {
    if (this.running) return this.running;
    this.running = (async () => {
      const mailboxes = (await this.mailboxesRepository?.findActive()) || [];
      let count = 0;
      // Small bounded batches avoid one failing mailbox delaying every other inbox.
      for (let i = 0; i < mailboxes.length && !this.stopped; i += 2) {
        const results = await Promise.allSettled(
          mailboxes.slice(i, i + 2).map((m) => this.fetchAndProcessMailbox(m)),
        );
        for (const result of results)
          if (result.status === "fulfilled") count += result.value;
          else
            logger.error(
              { message: String(result.reason?.message) },
              "Mailbox sync failed",
            );
      }
      return count;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  start(): void {
    this.stopped = false;
    void this.fetchAndProcess().catch((err) =>
      logger.error({ err }, "Inbox polling failed"),
    );
    this.timer = setInterval(
      () =>
        void this.fetchAndProcess().catch((err) =>
          logger.error({ err }, "Inbox polling failed"),
        ),
      getEnvConfig().IMAP_POLL_INTERVAL_MS,
    );
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([
      ...this.jobs,
      ...(this.running ? [this.running] : []),
    ]);
  }
}
