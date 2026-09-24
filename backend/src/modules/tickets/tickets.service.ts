import { withDbLock } from "../../db/lock.js";
import { eq, and, sql } from "drizzle-orm";
import {
  ticketAttachments,
  emailOutbox,
  tickets,
  ticketReplies,
  mailboxes,
} from "../../db/schema.js";
import { getEnvConfig } from "../../config/env.js";
import { TicketsRepository as Repository } from "./tickets.repository.js";
import crypto from "node:crypto";
import type {
  TicketsRepository,
  TicketFilters,
  PaginationParams,
  TicketWithDetails,
  PaginatedResult,
} from "./tickets.repository.js";
import type { SmtpService } from "../email/smtp.service.js";
import type { StorageService } from "../storage/storage.service.js";
import type {
  Ticket,
  TicketReply,
  TicketStatus,
  TicketPriority,
  SenderType,
} from "../../db/schema.js";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from "../../shared/errors.js";
import { logger } from "../../shared/logger.js";

export interface CreateTicketInput {
  senderEmail: string;
  recipientEmail?: string;
  mailboxId?: string;
  subject: string;
  body: string;
  messageId?: string;
  priority?: TicketPriority;
  assigneeId?: string;
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  priority?: TicketPriority;
  version?: number;
  assigneeId?: string | null;
}

export interface CreateReplyAttachment {
  originalName: string;
  mimeType?: string;
  content: Buffer;
}

export interface CreateReplyInput {
  body: string;
  senderType: SenderType;
  mailboxId?: string;
  authorId?: string;
  authorName?: string;
  attachments?: CreateReplyAttachment[];
  attachmentIds?: string[];
  idempotencyKey?: string;
}

export class TicketsService {
  constructor(
    private readonly ticketsRepo: TicketsRepository,
    private readonly smtpService?: SmtpService,
    private readonly storageService?: StorageService,
  ) {}

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const messageId =
      input.messageId || `<${crypto.randomUUID()}@api.helpdesk>`;

    // Check duplicate
    const existing = await this.ticketsRepo.findByMessageId(messageId);
    if (existing) {
      throw new ConflictError(
        `Ticket with Message-ID '${messageId}' already exists`,
      );
    }

    // Check if this message was previously deleted by user
    const wasDeleted = await this.ticketsRepo.isMessageDeleted(messageId);
    if (wasDeleted) {
      throw new ConflictError(
        `Ticket with Message-ID '${messageId}' was previously deleted`,
      );
    }

    if (input.assigneeId)
      await this.ticketsRepo.validateAssignee(
        input.assigneeId,
        input.mailboxId,
      );
    const ticket = await this.ticketsRepo.create({
      messageId,
      senderEmail: input.senderEmail,
      recipientEmail: input.recipientEmail,
      mailboxId: input.mailboxId,
      subject: input.subject,
      body: input.body,
      status: "WAITING",
      priority: input.priority || "MEDIUM",
      assigneeId: input.assigneeId,
    });

    logger.info(
      {
        ticketId: ticket.id,
        assigneeId: ticket.assigneeId,
        mailboxId: ticket.mailboxId,
      },
      "Ticket created via service",
    );
    return ticket;
  }

  async getTicketById(id: string): Promise<TicketWithDetails> {
    const ticket = await this.ticketsRepo.findById(id);
    if (!ticket) {
      throw new NotFoundError(`Ticket '${id}' not found`);
    }
    return ticket;
  }

  async validateReplyMailbox(mailboxId?: string | null): Promise<void> {
    try {
      await this.smtpService?.validateMailbox(mailboxId);
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : "Reply mailbox unavailable",
      );
    }
  }

  async listTickets(
    filters: TicketFilters = {},
    pagination: PaginationParams = {},
  ): Promise<PaginatedResult<TicketWithDetails>> {
    return this.ticketsRepo.findMany(filters, pagination);
  }

  async updateTicket(id: string, updates: UpdateTicketInput): Promise<Ticket> {
    return withDbLock(this.ticketsRepo.db, 740010, async (tx) => {
      const repo = new Repository(tx);
      const current = await repo.findById(id);
      if (!current) throw new NotFoundError("Ticket not found");
      if (updates.assigneeId)
        await repo.validateAssignee(updates.assigneeId, current.mailboxId);
      const { version, ...fields } = updates;
      const ticket = await repo.update(id, fields, version);
      if (!ticket) throw new NotFoundError("Ticket not found");
      return ticket;
    });
  }
  async assignTicket(
    id: string,
    assigneeId?: string | null,
    version?: number,
  ): Promise<Ticket> {
    return withDbLock(this.ticketsRepo.db, 740010, async (tx) => {
      const repo = new Repository(tx);
      const ticket = await repo.findById(id);
      if (!ticket) throw new NotFoundError("Ticket not found");
      const [mailbox] = ticket.mailboxId
        ? await tx
            .select()
            .from(mailboxes)
            .where(eq(mailboxes.id, ticket.mailboxId))
        : [];
      const target =
        assigneeId === undefined
          ? await repo.findLeastBusyActiveEmployeeId(mailbox?.targetRole)
          : assigneeId;
      if (target) await repo.validateAssignee(target, ticket.mailboxId);
      const updated = await repo.update(id, { assigneeId: target }, version);
      if (!updated) throw new NotFoundError("Ticket not found");
      return updated;
    });
  }

  async addReply(
    ticketId: string,
    input: CreateReplyInput,
  ): Promise<TicketReply> {
    if (!input.body?.trim())
      throw new ValidationError("Reply body cannot be empty");
    const total = (input.attachments || []).reduce(
      (n, a) => n + a.content.length,
      0,
    );
    if (total > getEnvConfig().MAX_MESSAGE_BYTES)
      throw new ValidationError("Attachments exceed total size limit");
    const requestHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          body: input.body,
          mailboxId: input.mailboxId || null,
          attachmentIds: input.attachmentIds || [],
          attachments: (input.attachments || []).map((a) => ({
            name: a.originalName,
            type: a.mimeType,
            hash: crypto.createHash("sha256").update(a.content).digest("hex"),
          })),
        }),
      )
      .digest("hex");
    return withDbLock(this.ticketsRepo.db, 740010, async (tx) => {
      const repo = new Repository(tx);
      if (input.idempotencyKey) {
        const previous = await repo.findReplyByKey(input.idempotencyKey);
        if (previous) {
          if (
            previous.ticketId !== ticketId ||
            previous.authorId !== input.authorId ||
            previous.body !== input.body ||
            (previous.requestHash && previous.requestHash !== requestHash)
          )
            throw new ConflictError("Idempotency key already used");
          return previous;
        }
      }
      const ticket = await repo.findById(ticketId);
      if (!ticket) throw new NotFoundError("Ticket not found");
      const reply = await repo.createReply({
        ticketId,
        body: input.body,
        senderType: input.senderType,
        authorId: input.authorId,
        authorName: input.authorName,
        messageId: "<reply-" + crypto.randomUUID() + "@helpdesk>",
        idempotencyKey: input.idempotencyKey,
        requestHash,
        deliveryStatus:
          input.senderType === "EMPLOYEE" ? "pending" : "received",
      });
      const storage = this.storageService?.withDb(tx);
      for (const attachment of input.attachments || []) {
        if (!storage) throw new ValidationError("Storage unavailable");
        await storage.saveAttachment({
          ticketId,
          replyId: reply.id,
          originalName: attachment.originalName,
          mimeType: attachment.mimeType || "application/octet-stream",
          content: attachment.content,
        });
      }
      let uploadBytes = total;
      for (const id of input.attachmentIds || []) {
        const [attachment] = await tx
          .select()
          .from(ticketAttachments)
          .where(eq(ticketAttachments.id, id));
        if (
          !attachment ||
          attachment.ticketId !== ticketId ||
          attachment.replyId ||
          attachment.isPurged ||
          !attachment.ingestKey?.startsWith("upload:" + input.authorId + ":")
        )
          throw new ValidationError("Invalid uploaded attachment");
        uploadBytes += attachment.size;
        await tx
          .update(ticketAttachments)
          .set({ replyId: reply.id })
          .where(eq(ticketAttachments.id, id));
      }
      if (uploadBytes > getEnvConfig().MAX_MESSAGE_BYTES)
        throw new ValidationError("Attachments exceed total size limit");
      if (input.senderType === "EMPLOYEE")
        await tx.insert(emailOutbox).values({
          replyId: reply.id,
          mailboxId: input.mailboxId || ticket.mailboxId,
        });
      await repo.update(ticketId, {
        status: input.senderType === "CUSTOMER" ? "WAITING" : "IN_PROGRESS",
        ...(!ticket.assigneeId && input.authorId
          ? { assigneeId: input.authorId }
          : {}),
      });
      return reply;
    });
  }

  async getReplies(
    ticketId: string,
    limit = 100,
    offset = 0,
  ): Promise<TicketReply[]> {
    const ticket = await this.ticketsRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError(`Ticket '${ticketId}' not found`);
    }

    return this.ticketsRepo.findRepliesByTicketId(ticketId, limit, offset);
  }

  async deleteTicket(id: string): Promise<boolean> {
    return withDbLock(this.ticketsRepo.db, 740010, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(740011)`);
      const repo = new Repository(tx);
      const ticket = await repo.findById(id);
      if (!ticket) throw new NotFoundError("Ticket not found");
      const sending = await tx
        .select({ id: emailOutbox.id })
        .from(emailOutbox)
        .innerJoin(ticketReplies, eq(emailOutbox.replyId, ticketReplies.id))
        .where(
          and(
            eq(ticketReplies.ticketId, id),
            eq(emailOutbox.status, "sending"),
          ),
        );
      if (sending.length)
        throw new ConflictError(
          "Wait for the outgoing reply to finish before deleting this ticket",
        );
      const replies = await tx
        .select()
        .from(ticketReplies)
        .where(eq(ticketReplies.ticketId, id));
      for (const messageId of [
        ticket.messageId,
        ...replies.map((r) => r.messageId),
      ].filter(Boolean) as string[])
        await repo.recordDeletedTicket({
          ticketId: id,
          messageId,
          mailboxId: ticket.mailboxId,
        });
      return repo.delete(id);
    });
  }
  async retryReply(
    ticketId: string,
    replyId: string,
    confirmPossibleDuplicate: boolean,
  ): Promise<TicketReply> {
    return withDbLock(this.ticketsRepo.db, 740011, async (tx) => {
      const [reply] = await tx
        .select()
        .from(ticketReplies)
        .where(
          and(
            eq(ticketReplies.id, replyId),
            eq(ticketReplies.ticketId, ticketId),
          ),
        );
      if (!reply) throw new NotFoundError("Reply not found");
      if (!["failed", "uncertain"].includes(reply.deliveryStatus))
        throw new ConflictError("Reply cannot be retried in its current state");
      if (reply.deliveryStatus === "uncertain" && !confirmPossibleDuplicate)
        throw new ConflictError(
          "Check Sent Items first and explicitly confirm possible duplicate delivery",
        );
      await tx
        .update(emailOutbox)
        .set({ status: "pending", lockedAt: null })
        .where(eq(emailOutbox.replyId, replyId));
      const [updated] = await tx
        .update(ticketReplies)
        .set({ deliveryStatus: "pending", deliveryError: null })
        .where(eq(ticketReplies.id, replyId))
        .returning();
      return updated;
    });
  }
  async stats(filters: TicketFilters = {}) {
    return this.ticketsRepo.stats(filters);
  }
}
