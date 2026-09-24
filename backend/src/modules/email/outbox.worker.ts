import fs from "node:fs";
import { and, eq, lt } from "drizzle-orm";
import type { AppDatabase } from "../../db/index.js";
import { withDbLock } from "../../db/lock.js";
import {
  emailOutbox,
  ticketReplies,
  ticketAttachments,
  tickets,
} from "../../db/schema.js";
import type { SmtpService } from "./smtp.service.js";
import type { StorageService } from "../storage/storage.service.js";
import { logger } from "../../shared/logger.js";
export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  constructor(
    private db: AppDatabase,
    private smtp: SmtpService,
    private storage: StorageService,
  ) {}
  async process(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async run(): Promise<void> {
    const job = await withDbLock(this.db, 740011, async (tx) => {
      // A stale send may already have reached the recipient. Never auto-resend.
      const stale = await tx
        .update(emailOutbox)
        .set({ status: "uncertain" })
        .where(
          and(
            eq(emailOutbox.status, "sending"),
            lt(emailOutbox.lockedAt, new Date(Date.now() - 600000)),
          ),
        )
        .returning();
      for (const item of stale)
        await tx
          .update(ticketReplies)
          .set({
            deliveryStatus: "uncertain",
            deliveryError:
              "Delivery interrupted; check Sent Items before retrying.",
          })
          .where(eq(ticketReplies.id, item.replyId));
      const [next] = await tx
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.status, "pending"))
        .orderBy(emailOutbox.createdAt)
        .limit(1);
      if (!next) return null;
      await tx
        .update(emailOutbox)
        .set({
          status: "sending",
          lockedAt: new Date(),
          attempts: next.attempts + 1,
        })
        .where(eq(emailOutbox.id, next.id));
      await tx
        .update(ticketReplies)
        .set({ deliveryStatus: "sending" })
        .where(eq(ticketReplies.id, next.replyId));
      return next;
    });
    if (!job) return;
    let dispatchStarted = false;
    try {
      const [reply] = await this.db
        .select()
        .from(ticketReplies)
        .where(eq(ticketReplies.id, job.replyId));
      const [ticket] = await this.db
        .select()
        .from(tickets)
        .where(eq(tickets.id, reply.ticketId));
      const records = await this.db
        .select()
        .from(ticketAttachments)
        .where(eq(ticketAttachments.replyId, reply.id));
      const attachments = [];
      for (const a of records) {
        if (a.isPurged) throw new Error("Reply attachment expired");
        attachments.push({
          filename: a.originalName,
          content: await fs.promises.readFile(
            await this.storage.checkedPath(a.storagePath),
          ),
          contentType: a.mimeType,
        });
      }
      await this.smtp.validateMailbox(job.mailboxId);
      dispatchStarted = true;
      const result = await this.smtp.sendReply({
        to: ticket.senderEmail,
        subject: ticket.subject,
        text: reply.body,
        messageId: reply.messageId || undefined,
        inReplyToMessageId: ticket.messageId,
        references: [ticket.messageId],
        providerMessageId: ticket.providerMessageId || undefined,
        mailboxId: job.mailboxId,
        attachments,
      });
      await withDbLock(this.db, 740011, async (tx) => {
        await tx
          .update(ticketReplies)
          .set({
            deliveryStatus: "sent",
            deliveryError: null,
            messageId: result.messageId,
            providerMessageId: result.providerMessageId,
          })
          .where(eq(ticketReplies.id, reply.id));
        await tx
          .update(emailOutbox)
          .set({ status: "sent" })
          .where(eq(emailOutbox.id, job.id));
      });
    } catch (error) {
      const status = dispatchStarted ? "uncertain" : "failed";
      await withDbLock(this.db, 740011, async (tx) => {
        await tx
          .update(ticketReplies)
          .set({
            deliveryStatus: status,
            deliveryError: dispatchStarted
              ? "Delivery could not be confirmed. Check Sent Items before retrying."
              : "Mailbox or attachment unavailable. Ask an administrator to check configuration.",
          })
          .where(eq(ticketReplies.id, job.replyId));
        await tx
          .update(emailOutbox)
          .set({ status })
          .where(eq(emailOutbox.id, job.id));
      });
      logger.error(
        { jobId: job.id, status },
        "Outgoing reply requires attention",
      );
    }
  }
  start(): void {
    this.timer = setInterval(
      () =>
        void this.process().catch((error) =>
          logger.error({ error }, "Outbox failed"),
        ),
      2000,
    );
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
