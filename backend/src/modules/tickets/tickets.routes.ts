import fs from "node:fs";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import type { TicketsService } from "./tickets.service.js";
import type { StorageService } from "../storage/storage.service.js";
import { TICKET_STATUSES, TICKET_PRIORITIES } from "../../db/schema.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../shared/errors.js";
import { principal } from "../auth/guard.js";
import { getEnvConfig } from "../../config/env.js";
const listSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignee: z.union([z.string().uuid(), z.literal("unassigned")]).optional(),
  mailbox_id: z.string().uuid().optional(),
  recipient_email: z.string().email().optional(),
  search: z.string().trim().max(200).optional(),
  my_tickets: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const createSchema = z.object({
  sender_email: z.string().email(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(100000),
  recipient_email: z.string().email().optional(),
  mailbox_id: z.string().uuid().optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  assignee_id: z.string().uuid().optional(),
});
const replySchema = z.object({
  body: z.string().trim().min(1).max(100000),
  sender_type: z.literal("EMPLOYEE").default("EMPLOYEE"),
  mailbox_id: z.string().uuid().nullable().optional(),
  attachment_ids: z.array(z.string().uuid()).max(20).optional(),
  attachments: z
    .array(
      z.object({
        original_name: z.string().min(1).max(255),
        mime_type: z.string().max(200).optional(),
        data: z
          .string()
          .regex(
            /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
          ),
      }),
    )
    .max(20)
    .optional(),
});
export function registerTicketRoutes(
  app: FastifyInstance,
  service: TicketsService,
  storage: StorageService | undefined,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void,
): void {
  const filters = (req: any) => {
    const q = listSchema.parse(req.query);
    return {
      q,
      f: {
        status: q.status,
        priority: q.priority,
        search: q.search,
        assigneeId:
          q.my_tickets === "true"
            ? principal(req).id
            : q.assignee === "unassigned"
              ? null
              : q.assignee,
        mailboxId: q.mailbox_id,
        recipientEmail: q.recipient_email,
      },
    };
  };
  app.get("/", async (req) => {
    const { q, f } = filters(req);
    return service.listTickets(f, { page: q.page, limit: q.limit });
  });
  app.get("/stats", async (req) => service.stats(filters(req).f));
  app.get("/limits", async () => ({
    maxAttachmentBytes: getEnvConfig().MAX_ATTACHMENT_BYTES,
    maxMessageBytes: getEnvConfig().MAX_MESSAGE_BYTES,
    maxAttachments: 20,
  }));
  app.post("/", async (req, reply) => {
    const b = createSchema.parse(req.body);
    return reply
      .code(201)
      .send(
        await service.createTicket({
          senderEmail: b.sender_email,
          subject: b.subject,
          body: b.body,
          recipientEmail: b.recipient_email,
          mailboxId: b.mailbox_id,
          priority: b.priority,
          assigneeId: b.assignee_id,
        }),
      );
  });
  app.get("/:id", async (req) =>
    service.getTicketById((req.params as { id: string }).id),
  );
  app.patch("/:id", async (req) => {
    const b = z
      .object({
        status: z.enum(TICKET_STATUSES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
        assignee_id: z.string().uuid().nullable().optional(),
        version: z.number().int().positive(),
      })
      .parse(req.body);
    const { assignee_id, ...rest } = b;
    return service.updateTicket((req.params as { id: string }).id, {
      ...rest,
      ...(assignee_id !== undefined ? { assigneeId: assignee_id } : {}),
    });
  });
  app.patch("/:id/assign", async (req) => {
    const b = z
      .object({
        assignee_id: z.string().uuid().nullable().optional(),
        version: z.number().int().positive(),
      })
      .parse(req.body);
    return service.assignTicket(
      (req.params as { id: string }).id,
      b.assignee_id,
      b.version,
    );
  });
  app.get("/:id/replies", async (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    return service.getReplies(
      (req.params as { id: string }).id,
      q.limit,
      q.offset,
    );
  });
  app.post("/:id/replies/:replyId/retry", async (req) => {
    const params = z
      .object({ id: z.string().uuid(), replyId: z.string().uuid() })
      .parse(req.params);
    const body = z
      .object({ confirmPossibleDuplicate: z.boolean().default(false) })
      .parse(req.body);
    return service.retryReply(
      params.id,
      params.replyId,
      body.confirmPossibleDuplicate,
    );
  });
  app.post("/:id/replies", async (req, reply) => {
    const id = (req.params as { id: string }).id,
      b = replySchema.parse(req.body),
      user = principal(req);
    const key = z.string().uuid().parse(req.headers["idempotency-key"]);
    const ticket = await service.getTicketById(id);
    const replyMailboxId =
      b.mailbox_id === undefined ? ticket.mailboxId : b.mailbox_id;
    await service.validateReplyMailbox(replyMailboxId);
    if ((b.attachment_ids?.length || 0) + (b.attachments?.length || 0) > 20)
      throw new ValidationError("Too many attachments");
    return reply
      .code(201)
      .send(
        await service.addReply(id, {
          body: b.body,
          senderType: "EMPLOYEE",
          authorId: user.id,
          authorName: user.name,
          mailboxId: replyMailboxId || undefined,
          idempotencyKey: key,
          attachmentIds: b.attachment_ids,
          attachments: b.attachments?.map((a) => ({
            originalName: a.original_name,
            mimeType: a.mime_type,
            content: Buffer.from(a.data, "base64"),
          })),
        }),
      );
  });
  app.addContentTypeParser("application/octet-stream", (req, payload, done) =>
    done(null, payload),
  );
  app.post("/:id/uploads", async (req, reply) => {
    if (!storage) throw new NotFoundError("Storage unavailable");
    const id = (req.params as { id: string }).id;
    await service.getTicketById(id);
    const filename = z
      .string()
      .min(1)
      .max(255)
      .parse(decodeURIComponent(String(req.headers["x-filename"] || "")));
    const type = z
      .string()
      .max(200)
      .parse(req.headers["x-file-type"] || "application/octet-stream");
    const user = principal(req),
      key = z.string().uuid().parse(req.headers["idempotency-key"]);
    if (!(req.body instanceof Readable))
      throw new ValidationError("Send an application/octet-stream body");
    const record = await storage.saveStream({
      ticketId: id,
      originalName: filename,
      mimeType: type,
      stream: req.body,
      ingestKey: "upload:" + user.id + ":" + id + ":" + key,
    });
    const { storagePath, ...safe } = record;
    return reply.code(201).send(safe);
  });
  app.get("/:id/attachments", async (req) => {
    const list =
      (await storage?.findByTicketId((req.params as { id: string }).id)) || [];
    return list
      .filter((a) => !a.ingestKey?.startsWith("upload:") || a.replyId)
      .map(({ storagePath, ingestKey, ...safe }) => safe);
  });
  app.get("/:id/attachments/:attachmentId/download", async (req, reply) => {
    if (!storage) throw new NotFoundError("Storage unavailable");
    const { id, attachmentId } = req.params as {
      id: string;
      attachmentId: string;
    };
    const a = await storage.findById(attachmentId);
    if (!a || a.ticketId !== id)
      throw new NotFoundError("Attachment not found");
    if (a.isPurged)
      return reply
        .code(410)
        .send({
          error: "GONE",
          message: "Attachment expired under the retention policy",
        });
    const file = await storage.checkedPath(a.storagePath);
    try {
      await fs.promises.access(file);
    } catch {
      return reply
        .code(410)
        .send({ error: "GONE", message: "Attachment unavailable" });
    }
    const inline =
      (req.query as { inline?: string }).inline === "true" &&
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        a.mimeType.toLowerCase(),
      );
    reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
    reply.header(
      "Content-Disposition",
      (inline ? "inline" : "attachment") +
        '; filename="' +
        encodeURIComponent(a.originalName) +
        '"',
    );
    return reply
      .type(inline ? a.mimeType : "application/octet-stream")
      .send(fs.createReadStream(file));
  });
  app.delete("/:id", async (req) => {
    if (!principal(req).isAdmin)
      throw new ForbiddenError("Administrator access required");
    const id = (req.params as { id: string }).id;
    await service.getTicketById(id);
    await service.deleteTicket(id);
    await storage?.deleteTicketStorage(id);
    return { success: true };
  });
  done();
}
