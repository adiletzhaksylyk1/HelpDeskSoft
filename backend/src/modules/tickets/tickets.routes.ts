import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import type { TicketsService } from './tickets.service.js';
import { TICKET_STATUSES, TICKET_PRIORITIES, SENDER_TYPES } from '../../db/schema.js';

const listQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignee: z.string().optional(),
  mailbox_id: z.string().optional(),
  recipient_email: z.string().optional(),
  my_tickets: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const patchTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});

const patchAssignSchema = z.object({
  assignee_id: z.string().uuid().nullable().optional(),
});

const postReplyAttachmentSchema = z.object({
  original_name: z.string().min(1),
  mime_type: z.string().optional(),
  data: z.string().min(1),
});

const postReplySchema = z.object({
  body: z.string().min(1, 'Reply body cannot be empty'),
  sender_type: z.enum(SENDER_TYPES),
  mailbox_id: z.string().uuid().optional().nullable(),
  author_name: z.string().optional(),
  attachments: z.array(postReplyAttachmentSchema).max(20, 'Too many attachments').optional(),
});

const createTicketSchema = z.object({
  sender_email: z.string().email(),
  recipient_email: z.string().optional(),
  mailbox_id: z.string().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  message_id: z.string().optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignee_id: z.string().uuid().optional(),
});

import fs from 'node:fs';
import type { StorageService } from '../storage/storage.service.js';
import { NotFoundError, UnauthorizedError, ForbiddenError } from '../../shared/errors.js';
import { getEnvConfig } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

export function registerTicketRoutes(
  app: FastifyInstance,
  ticketsService: TicketsService,
  storageService: StorageService | undefined,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
): void {
  // GET /api/tickets - Requires authenticated staff session
  app.get('/', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('Authentication token required to view tickets');
    }

    const query = listQuerySchema.parse(req.query);
    let effectiveAssignee: string | null | undefined = undefined;

    if (query.assignee) {
      effectiveAssignee = query.assignee === 'unassigned' ? null : query.assignee;
    }

    if (query.my_tickets) {
      const payload = req.user as { id: string };
      effectiveAssignee = payload.id;
    }

    const result = await ticketsService.listTickets(
      {
        status: query.status,
        priority: query.priority,
        assigneeId: effectiveAssignee,
        mailboxId: query.mailbox_id,
        recipientEmail: query.recipient_email,
      },
      {
        page: query.page,
        limit: query.limit,
      }
    );
    return reply.status(200).send(result);
  });

  // POST /api/tickets - Public/Ingestion ticket creation
  app.post('/', async (req, reply) => {
    const body = createTicketSchema.parse(req.body);
    const created = await ticketsService.createTicket({
      senderEmail: body.sender_email,
      recipientEmail: body.recipient_email,
      mailboxId: body.mailbox_id,
      subject: body.subject,
      body: body.body,
      messageId: body.message_id,
      priority: body.priority,
      assigneeId: body.assignee_id,
    });
    return reply.status(201).send(created);
  });

  // GET /api/tickets/:id - Staff only
  app.get('/:id', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('Authentication required to view ticket details');
    }
    const { id } = req.params as { id: string };
    const ticket = await ticketsService.getTicketById(id);
    return reply.status(200).send(ticket);
  });

  // PATCH /api/tickets/:id - Update ticket status/priority (Staff only)
  app.patch('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('Authentication required to update ticket');
    }

    const body = patchTicketSchema.parse(req.body);
    const updated = await ticketsService.updateTicket(id, body);
    return reply.status(200).send(updated);
  });

  // PATCH /api/tickets/:id/assign - Assign ticket (Staff only)
  app.patch('/:id/assign', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('Authentication required to assign ticket');
    }

    const payload = req.user as { id: string; email: string };
    const body = patchAssignSchema.parse(req.body);
    const updated = await ticketsService.assignTicket(id, body.assignee_id);
    logger.info({ ticketId: id, assigneeId: body.assignee_id, by: payload.email }, 'Ticket assignee changed');
    return reply.status(200).send(updated);
  });

  // GET /api/tickets/:id/replies - Staff only
  app.get('/:id/replies', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('Authentication required to view ticket replies');
    }
    const { id } = req.params as { id: string };
    const replies = await ticketsService.getReplies(id);
    return reply.status(200).send(replies);
  });

  // POST /api/tickets/:id/replies - Replies (Staff requires auth, Customer replies do not)
  app.post('/:id/replies', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = postReplySchema.parse(req.body);

    let authorId: string | undefined = undefined;
    let authorName: string | undefined = body.author_name;
    if (body.sender_type === 'EMPLOYEE') {
      try {
        await req.jwtVerify();
        const user = req.user as { id: string; email: string; role: string; name?: string } | undefined;
        authorId = user?.id;
        if (!authorName && user?.name) {
          authorName = user.name;
        }
      } catch {
        throw new UnauthorizedError('Authentication required to send employee replies');
      }
    }

    const replyAttachments = (body.attachments || []).map((att) => ({
      originalName: att.original_name,
      mimeType: att.mime_type || 'application/octet-stream',
      content: Buffer.from(att.data, 'base64'),
    }));

    const replyRecord = await ticketsService.addReply(id, {
      body: body.body,
      senderType: body.sender_type,
      mailboxId: body.mailbox_id || undefined,
      authorId,
      authorName,
      attachments: replyAttachments.length > 0 ? replyAttachments : undefined,
    });
    return reply.status(201).send(replyRecord);
  });

  // GET /api/tickets/:id/attachments - Staff only
  app.get('/:id/attachments', async (req, reply) => {
    const query = (req.query || {}) as { token?: string };
    try {
      if (query.token) {
        req.user = app.jwt.verify(query.token);
      } else {
        await req.jwtVerify();
      }
    } catch {
      throw new UnauthorizedError('Authentication required to view attachments');
    }
    const { id } = req.params as { id: string };
    if (!storageService) {
      return reply.status(200).send([]);
    }
    const attachments = await storageService.findByTicketId(id);
    return reply.status(200).send(attachments);
  });

  // GET /api/tickets/:id/attachments/:attachmentId/download - Staff only
  app.get('/:id/attachments/:attachmentId/download', async (req, reply) => {
    const query = (req.query || {}) as { inline?: string; token?: string };
    try {
      if (query.token) {
        req.user = app.jwt.verify(query.token);
      } else {
        await req.jwtVerify();
      }
    } catch {
      throw new UnauthorizedError('Authentication required to download attachments');
    }
    const { id, attachmentId } = req.params as { id: string; attachmentId: string };
    const { inline } = query;
    if (!storageService) {
      throw new NotFoundError('Storage service not available');
    }
    const attachment = await storageService.findById(attachmentId);
    if (!attachment || attachment.ticketId !== id) {
      throw new NotFoundError('Attachment not found');
    }

    if (attachment.isPurged || !fs.existsSync(attachment.storagePath)) {
      const env = getEnvConfig();
      const retentionHours = env.ATTACHMENT_RETENTION_HOURS || 168;
      const retentionText = retentionHours % 24 === 0 && retentionHours >= 48
        ? `${retentionHours / 24}-days`
        : (retentionHours === 24 ? '24-hour' : `${retentionHours}-hour`);

      return reply.status(410).send({
        error: 'GONE',
        message: `This attachment has expired and was purged per the ${retentionText} retention policy for resolved tickets.`,
        purgedAt: attachment.purgedAt,
      });
    }

    // Security fix (SEC-04): Prevent Stored XSS via malicious inline attachments
    // Only allow inline disposition for safe, non-executable image types
    const SAFE_INLINE_MIME_TYPES = new Set([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ]);

    const isSafeInline = inline === 'true' && SAFE_INLINE_MIME_TYPES.has((attachment.mimeType || '').toLowerCase());
    const dispositionType = isSafeInline ? 'inline' : 'attachment';

    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Type', isSafeInline ? attachment.mimeType : (attachment.mimeType || 'application/octet-stream'));
    reply.header('Content-Disposition', `${dispositionType}; filename="${encodeURIComponent(attachment.originalName)}"`);

    const stream = fs.createReadStream(attachment.storagePath);
    return reply.send(stream);
  });

  // DELETE /api/tickets/:id - Delete ticket and storage files (Administrators only)
  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };

    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('Authentication required to delete tickets');
    }

    const payload = req.user as { role?: string; id?: string; email?: string };
    if (payload?.role !== 'admin') {
      throw new ForbiddenError('Only administrators can delete tickets');
    }

    if (storageService) {
      await storageService.deleteTicketStorage(id);
    }
    await ticketsService.deleteTicket(id);
    logger.info({ ticketId: id, by: payload.email }, 'Ticket deleted by admin');
    return reply.status(200).send({ success: true, message: 'Ticket deleted successfully' });
  });

  done();
}

