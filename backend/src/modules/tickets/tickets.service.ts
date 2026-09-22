import crypto from 'node:crypto';
import type { TicketsRepository, TicketFilters, PaginationParams, TicketWithDetails, PaginatedResult } from './tickets.repository.js';
import type { SmtpService } from '../email/smtp.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { Ticket, TicketReply, TicketStatus, TicketPriority, SenderType } from '../../db/schema.js';
import { NotFoundError, ValidationError, ConflictError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

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
}

export class TicketsService {
  constructor(
    private readonly ticketsRepo: TicketsRepository,
    private readonly smtpService?: SmtpService,
    private readonly storageService?: StorageService
  ) {}


  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    const messageId = input.messageId || `<${crypto.randomUUID()}@api.helpdesk>`;
    
    // Check duplicate
    const existing = await this.ticketsRepo.findByMessageId(messageId);
    if (existing) {
      throw new ConflictError(`Ticket with Message-ID '${messageId}' already exists`);
    }

    // Check if this message was previously deleted by user
    const wasDeleted = await this.ticketsRepo.isMessageDeleted(messageId);
    if (wasDeleted) {
      throw new ConflictError(`Ticket with Message-ID '${messageId}' was previously deleted`);
    }


    const ticket = await this.ticketsRepo.create({
      messageId,
      senderEmail: input.senderEmail,
      recipientEmail: input.recipientEmail,
      mailboxId: input.mailboxId,
      subject: input.subject,
      body: input.body,
      status: 'WAITING',
      priority: input.priority || 'MEDIUM',
      assigneeId: input.assigneeId,
    });

    logger.info({ ticketId: ticket.id, assigneeId: ticket.assigneeId, mailboxId: ticket.mailboxId }, 'Ticket created via service');
    return ticket;
  }

  async getTicketById(id: string): Promise<TicketWithDetails> {
    const ticket = await this.ticketsRepo.findById(id);
    if (!ticket) {
      throw new NotFoundError(`Ticket '${id}' not found`);
    }
    return ticket;
  }

  async listTickets(
    filters: TicketFilters = {},
    pagination: PaginationParams = {}
  ): Promise<PaginatedResult<TicketWithDetails>> {
    return this.ticketsRepo.findMany(filters, pagination);
  }

  async updateTicket(id: string, updates: UpdateTicketInput): Promise<Ticket> {
    const existing = await this.ticketsRepo.findById(id);
    if (!existing) {
      throw new NotFoundError(`Ticket '${id}' not found`);
    }

    const updated = await this.ticketsRepo.update(id, updates);
    if (!updated) {
      throw new NotFoundError(`Ticket '${id}' not found`);
    }

    logger.info({ ticketId: id, updates }, 'Ticket updated');
    return updated;
  }

  async assignTicket(id: string, assigneeId?: string | null): Promise<Ticket> {
    const existing = await this.ticketsRepo.findById(id);
    if (!existing) {
      throw new NotFoundError(`Ticket '${id}' not found`);
    }

    let targetAssigneeId = assigneeId;
    if (targetAssigneeId === undefined) {
      // Auto-assign
      targetAssigneeId = await this.ticketsRepo.findLeastBusyActiveEmployeeId();
    }

    const updated = await this.ticketsRepo.update(id, { assigneeId: targetAssigneeId });
    if (!updated) {
      throw new NotFoundError(`Ticket '${id}' not found`);
    }

    logger.info({ ticketId: id, assigneeId: targetAssigneeId }, 'Ticket assigned');
    return updated;
  }

  async addReply(ticketId: string, input: CreateReplyInput): Promise<TicketReply> {
    const ticket = await this.ticketsRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError(`Ticket '${ticketId}' not found`);
    }

    if (!input.body || input.body.trim().length === 0) {
      throw new ValidationError('Reply body cannot be empty');
    }

    let replyMessageId: string | undefined = `<reply-${crypto.randomUUID()}@helpdesk>`;

    // Save attachments to storage if present
    if (this.storageService && input.attachments && input.attachments.length > 0) {
      for (const att of input.attachments) {
        try {
          await this.storageService.saveAttachment({
            ticketId,
            originalName: att.originalName,
            mimeType: att.mimeType || 'application/octet-stream',
            content: att.content,
          });
        } catch (err) {
          logger.error({ err, ticketId, filename: att.originalName }, 'Failed to save reply attachment');
        }
      }
    }

    // If EMPLOYEE replies, send email to customer via SMTP with thread preservation
    if (input.senderType === 'EMPLOYEE' && this.smtpService) {
      try {
        const existingReplies = ticket.replies || [];
        const references: string[] = [ticket.messageId];
        for (const rep of existingReplies) {
          if (rep.messageId) {
            references.push(rep.messageId);
          }
        }

        const lastMessageId = references[references.length - 1];
        const emailAttachments = (input.attachments || []).map((att) => ({
          filename: att.originalName,
          content: att.content,
          contentType: att.mimeType,
        }));

        const replySubject = ticket.subject.startsWith('Re:') ? ticket.subject : `Re: ${ticket.subject}`;
        const sendResult = await this.smtpService.sendReply({
          to: ticket.senderEmail,
          subject: replySubject,
          text: input.body,
          inReplyToMessageId: lastMessageId,
          references,
          mailboxId: input.mailboxId || ticket.mailboxId,
          attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
        });

        replyMessageId = sendResult.messageId || replyMessageId;
      } catch (err: any) {
        logger.error({ err, ticketId }, 'Failed to dispatch email reply over SMTP/Graph');
        throw new Error(`Email dispatch failed: ${err?.message || String(err)}`);
      }
    }


    const reply = await this.ticketsRepo.createReply({
      ticketId,
      body: input.body,
      senderType: input.senderType,
      messageId: replyMessageId,
      authorId: input.authorId,
      authorName: input.authorName,
    });

    // Auto-assignment & auto-status transition when staff replies
    if (input.senderType === 'EMPLOYEE') {
      const ticketUpdates: Partial<Pick<Ticket, 'status' | 'assigneeId'>> = {};

      // Take Ownership: Auto-assign to responding specialist if ticket is unassigned
      if (input.authorId && !ticket.assigneeId) {
        ticketUpdates.assigneeId = input.authorId;
      }

      // Auto-transition status to IN_PROGRESS if ticket was WAITING or RESOLVED
      if (ticket.status !== 'IN_PROGRESS') {
        ticketUpdates.status = 'IN_PROGRESS';
      }

      if (Object.keys(ticketUpdates).length > 0) {
        try {
          await this.ticketsRepo.update(ticketId, ticketUpdates);
          logger.info({ ticketId, updates: ticketUpdates }, 'Ticket auto-updated on employee reply');
        } catch (err: any) {
          if (ticketUpdates.assigneeId) {
            delete ticketUpdates.assigneeId;
            if (Object.keys(ticketUpdates).length > 0) {
              await this.ticketsRepo.update(ticketId, ticketUpdates).catch(() => {});
            }
          }
        }
      }
    }

    logger.info({ replyId: reply.id, ticketId, senderType: input.senderType }, 'Reply created successfully');
    return reply;
  }

  async getReplies(ticketId: string): Promise<TicketReply[]> {
    const ticket = await this.ticketsRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundError(`Ticket '${ticketId}' not found`);
    }

    return this.ticketsRepo.findRepliesByTicketId(ticketId);
  }

  async deleteTicket(id: string): Promise<boolean> {
    const ticket = await this.ticketsRepo.findById(id);
    if (!ticket) {
      logger.info({ ticketId: id }, 'Ticket already deleted or does not exist');
      return true;
    }

    // Record original ticket messageId as deleted to prevent re-creation during IMAP fetch
    if (ticket.messageId) {
      await this.ticketsRepo.recordDeletedTicket({
        ticketId: ticket.id,
        messageId: ticket.messageId,
        subject: ticket.subject,
        senderEmail: ticket.senderEmail,
        mailboxId: ticket.mailboxId,
      });
    }

    // Also record any replies with messageId to prevent thread fragments from creating new tickets
    const replies = await this.ticketsRepo.findRepliesByTicketId(id);
    for (const reply of replies) {
      if (reply.messageId) {
        await this.ticketsRepo.recordDeletedTicket({
          ticketId: ticket.id,
          messageId: reply.messageId,
          subject: ticket.subject,
          senderEmail: ticket.senderEmail,
          mailboxId: ticket.mailboxId,
        });
      }
    }

    const success = await this.ticketsRepo.delete(id);
    logger.info({ ticketId: id, messageId: ticket.messageId }, 'Ticket deleted successfully and registered in deleted_tickets tombstone');
    return success;
  }
}


