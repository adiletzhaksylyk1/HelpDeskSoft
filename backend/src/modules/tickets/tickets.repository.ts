import { withDbLock } from "../../db/lock.js";
import { ConflictError, ValidationError } from "../../shared/errors.js";
import { or, ilike, getTableColumns } from "drizzle-orm";
import crypto from "node:crypto";
import { eq, and, sql, desc, count, isNull } from "drizzle-orm";
import type { AppDatabase } from "../../db/index.js";
import {
  tickets,
  ticketReplies,
  users,
  deletedTickets,
  mailboxes,
  emailOutbox,
  type Ticket,
  type NewTicket,
  type TicketReply,
  type NewTicketReply,
  type TicketStatus,
  type TicketPriority,
  type DeletedTicket,
  type NewDeletedTicket,
} from "../../db/schema.js";

export interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  mailboxId?: string;
  recipientEmail?: string;
  search?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TicketWithDetails extends Ticket {
  assignee?: {
    id: string;
    name: string;
    email: string;
  } | null;
  replies?: TicketReply[];
  replyCount?: number;
}

export class TicketsRepository {
  constructor(readonly db: AppDatabase) {}

  async findByMessageId(messageId: string): Promise<Ticket | null> {
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.messageId, messageId))
      .limit(1);
    return ticket || null;
  }

  async findById(id: string): Promise<TicketWithDetails | null> {
    const [ticket] = await this.db
      .select()
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1);

    if (!ticket) {
      return null;
    }

    let assignee: { id: string; name: string; email: string } | null = null;
    if (ticket.assigneeId) {
      const [user] = await this.db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, ticket.assigneeId))
        .limit(1);
      assignee = user || null;
    }

    const replies = await this.findRepliesByTicketId(id, 50);
    const [replyTotal] = await this.db
      .select({ total: count() })
      .from(ticketReplies)
      .where(eq(ticketReplies.ticketId, id));

    return {
      ...ticket,
      assignee,
      replies,
      replyCount: Number(replyTotal.total),
    };
  }

  async findMany(
    filters: TicketFilters = {},
    pagination: PaginationParams = {},
  ): Promise<PaginatedResult<TicketWithDetails>> {
    const page = Math.max(1, pagination.page || 1);
    const limit = Math.min(100, Math.max(1, pagination.limit || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (filters.search) {
      const term =
        "%" +
        filters.search.replace(/[\\%_]/g, (character) => "\\" + character) +
        "%";
      conditions.push(
        or(
          ilike(tickets.subject, term),
          ilike(tickets.senderEmail, term),
          ilike(tickets.body, term),
        ),
      );
    }
    if (filters.status) {
      conditions.push(eq(tickets.status, filters.status));
    }
    if (filters.priority) {
      conditions.push(eq(tickets.priority, filters.priority));
    }
    if (filters.assigneeId !== undefined) {
      if (filters.assigneeId === null) {
        conditions.push(isNull(tickets.assigneeId));
      } else {
        conditions.push(eq(tickets.assigneeId, filters.assigneeId));
      }
    }
    if (filters.mailboxId) {
      conditions.push(eq(tickets.mailboxId, filters.mailboxId));
    }
    if (filters.recipientEmail) {
      conditions.push(eq(tickets.recipientEmail, filters.recipientEmail));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalCountResult] = await this.db
      .select({ count: count() })
      .from(tickets)
      .where(whereClause);

    const total = Number(totalCountResult?.count || 0);
    const totalPages = Math.ceil(total / limit) || 1;

    const items = await this.db
      .select({
        ticket: {
          ...getTableColumns(tickets),
          body: sql<string>`LEFT(${tickets.body}, 240)`.as("body_preview"),
        },
        assignee: {
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(tickets)
      .leftJoin(users, eq(tickets.assigneeId, users.id))
      .where(whereClause)
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(limit)
      .offset(offset);

    const formattedData: TicketWithDetails[] = items.map(
      ({ ticket, assignee }) => ({
        ...ticket,
        assignee: assignee?.id ? assignee : null,
      }),
    );

    return {
      data: formattedData,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findLeastBusyActiveEmployeeId(
    txOrRole?: AppDatabase | string | null,
    targetRole?: string | null,
  ): Promise<string | null> {
    let client: AppDatabase = this.db;
    let effectiveTargetRole: string | null | undefined = targetRole;

    if (typeof txOrRole === "string") {
      effectiveTargetRole = txOrRole;
    } else if (txOrRole && typeof (txOrRole as any).execute === "function") {
      client = txOrRole;
    }

    // 1. If targetRole is specified, try to find an active user with that specific role (or any of the multiple selected roles)
    if (effectiveTargetRole && effectiveTargetRole.trim()) {
      const roles = effectiveTargetRole
        .split(",")
        .map((r) => r.trim().toLowerCase())
        .filter(Boolean);

      if (roles.length === 1) {
        const roleResult = await client.execute(sql`
          SELECT u.id, COUNT(t.id) as active_count
          FROM users u
          LEFT JOIN tickets t ON t.assignee_id = u.id AND t.status != 'RESOLVED'
          WHERE u.is_active = true AND LOWER(u.role) = ${roles[0]}
          GROUP BY u.id, u.role
          ORDER BY active_count ASC, u.id ASC
          LIMIT 1
        `);
        const roleRows = Array.isArray(roleResult)
          ? roleResult
          : (roleResult as any)?.rows;
        if (roleRows && roleRows.length > 0 && roleRows[0].id) {
          return roleRows[0].id;
        }
      } else if (roles.length > 1) {
        const roleInSql = sql.join(
          roles.map((r) => sql`${r}`),
          sql`, `,
        );
        const roleResult = await client.execute(sql`
          SELECT u.id, COUNT(t.id) as active_count
          FROM users u
          LEFT JOIN tickets t ON t.assignee_id = u.id AND t.status != 'RESOLVED'
          WHERE u.is_active = true AND LOWER(u.role) IN (${roleInSql})
          GROUP BY u.id, u.role
          ORDER BY active_count ASC, u.id ASC
          LIMIT 1
        `);
        const roleRows = Array.isArray(roleResult)
          ? roleResult
          : (roleResult as any)?.rows;
        if (roleRows && roleRows.length > 0 && roleRows[0].id) {
          return roleRows[0].id;
        }
      }
      // An explicitly routed mailbox stays unassigned when nobody is available.
      return null;
    }

    // 2. With no routing policy, use the shared staff queue.
    // Prioritizes non-admin over 'admin', then least busy, then id for stability
    const result = await client.execute(sql`
      SELECT u.id, COUNT(t.id) as active_count
      FROM users u
      LEFT JOIN tickets t ON t.assignee_id = u.id AND t.status != 'RESOLVED'
      WHERE u.is_active = true
      GROUP BY u.id, u.role
      ORDER BY 
        CASE WHEN u.role != 'admin' THEN 0 ELSE 1 END ASC,
        active_count ASC,
        u.id ASC
      LIMIT 1
    `);

    const rows = Array.isArray(result) ? result : (result as any)?.rows;
    if (!rows || rows.length === 0) {
      return null;
    }

    return rows[0].id || null;
  }

  async create(
    data: Omit<NewTicket, "id" | "createdAt" | "updatedAt" | "messageId"> & {
      messageId?: string;
    },
    tx?: AppDatabase,
  ): Promise<Ticket> {
    if (!tx)
      return withDbLock(this.db, 740010, (locked) =>
        new TicketsRepository(locked).create(data, locked),
      );
    const client = tx;

    let assigneeId = data.assigneeId;
    if (assigneeId === undefined) {
      let targetRole: string | null = null;
      if (data.mailboxId) {
        const [mb] = await client
          .select({ targetRole: mailboxes.targetRole })
          .from(mailboxes)
          .where(eq(mailboxes.id, data.mailboxId))
          .limit(1);
        if (mb?.targetRole) {
          targetRole = mb.targetRole;
        }
      }
      assigneeId = await this.findLeastBusyActiveEmployeeId(client, targetRole);
    }

    const messageId =
      data.messageId || `<${crypto.randomUUID()}@generated.local>`;

    const [created] = await client
      .insert(tickets)
      .values({
        ...data,
        messageId,
        resolvedAt: data.status === "RESOLVED" ? new Date() : null,
        assigneeId,
      })
      .returning();

    return created;
  }

  async update(
    id: string,
    updates: Partial<Pick<Ticket, "status" | "priority" | "assigneeId">>,
    expectedVersion?: number,
  ): Promise<Ticket | null> {
    const [updated] = await this.db
      .update(tickets)
      .set({
        ...updates,
        ...(updates.status
          ? {
              resolvedAt:
                updates.status === "RESOLVED"
                  ? sql`COALESCE(${tickets.resolvedAt}, now())`
                  : null,
            }
          : {}),
        version: sql`${tickets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        expectedVersion === undefined
          ? eq(tickets.id, id)
          : and(eq(tickets.id, id), eq(tickets.version, expectedVersion)),
      )
      .returning();

    if (!updated && expectedVersion !== undefined)
      throw new ConflictError("Ticket changed. Refresh before saving.");
    return updated || null;
  }

  async createReply(
    data: Omit<NewTicketReply, "id" | "createdAt">,
  ): Promise<TicketReply> {
    const [reply] = await this.db
      .insert(ticketReplies)
      .values(data)
      .returning();

    return reply;
  }

  async findRepliesByTicketId(
    ticketId: string,
    limit = 100,
    offset = 0,
  ): Promise<TicketReply[]> {
    const rows = await this.db
      .select({
        reply: ticketReplies,
        author: {
          id: users.id,
          name: users.name,
        },
      })
      .from(ticketReplies)
      .leftJoin(users, eq(ticketReplies.authorId, users.id))
      .where(eq(ticketReplies.ticketId, ticketId))
      .orderBy(ticketReplies.createdAt, ticketReplies.id)
      .limit(limit)
      .offset(offset);

    return rows.map(({ reply, author }) => ({
      ...reply,
      authorName: reply.authorName || author?.name || null,
    }));
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(tickets)
      .where(eq(tickets.id, id))
      .returning();
    return deleted.length > 0;
  }

  async recordDeletedTicket(data: {
    ticketId?: string;
    messageId: string;
    subject?: string;
    senderEmail?: string;
    mailboxId?: string | null;
  }): Promise<void> {
    if (!data.messageId) return;
    const exists = await this.isMessageDeleted(data.messageId);
    if (exists) return;

    await this.db.insert(deletedTickets).values({
      ticketId: data.ticketId,
      messageId: data.messageId,
      subject: data.subject,
      senderEmail: data.senderEmail,
      mailboxId: data.mailboxId || null,
    });
  }

  async isMessageDeleted(messageId: string): Promise<boolean> {
    if (!messageId) return false;
    const result = await this.db
      .select({ id: deletedTickets.id })
      .from(deletedTickets)
      .where(eq(deletedTickets.messageId, messageId))
      .limit(1);
    return result.length > 0;
  }

  async findDeletedByMessageId(
    messageId: string,
  ): Promise<DeletedTicket | null> {
    if (!messageId) return null;
    const [deleted] = await this.db
      .select()
      .from(deletedTickets)
      .where(eq(deletedTickets.messageId, messageId))
      .limit(1);
    return deleted || null;
  }

  async validateAssignee(id: string, mailboxId?: string | null): Promise<void> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.isActive, true)));
    if (!user)
      throw new ValidationError("Assignee must be an active staff member");
    if (mailboxId) {
      const [mb] = await this.db
        .select()
        .from(mailboxes)
        .where(eq(mailboxes.id, mailboxId));
      if (
        mb?.targetRole &&
        !mb.targetRole
          .split(",")
          .map((r) => r.trim().toLowerCase())
          .includes(user.role.toLowerCase())
      )
        throw new ValidationError(
          "Assignee is outside the mailbox routing departments",
        );
    }
  }
  async findThread(
    messageIds: string[],
    mailboxId?: string,
  ): Promise<Ticket | null> {
    for (const messageId of messageIds.slice(-50).reverse()) {
      const root = await this.findByMessageId(messageId);
      if (root && (root.mailboxId || undefined) === mailboxId) return root;
      const [reply] = await this.db
        .select()
        .from(ticketReplies)
        .where(eq(ticketReplies.messageId, messageId))
        .limit(1);
      if (reply) {
        const [ticket] = await this.db
          .select()
          .from(tickets)
          .where(eq(tickets.id, reply.ticketId));
        if (ticket && (ticket.mailboxId || undefined) === mailboxId)
          return ticket;
      }
    }
    return null;
  }
  async findReplyByMessageId(messageId: string): Promise<TicketReply | null> {
    const [reply] = await this.db
      .select()
      .from(ticketReplies)
      .where(eq(ticketReplies.messageId, messageId))
      .limit(1);
    return reply || null;
  }
  async findReplyByKey(key: string): Promise<TicketReply | null> {
    const [reply] = await this.db
      .select()
      .from(ticketReplies)
      .where(eq(ticketReplies.idempotencyKey, key))
      .limit(1);
    return reply || null;
  }
  async stats(filters: TicketFilters = {}): Promise<Record<string, unknown>> {
    const conditions = [];
    if (filters.assigneeId === null)
      conditions.push(isNull(tickets.assigneeId));
    else if (filters.assigneeId)
      conditions.push(eq(tickets.assigneeId, filters.assigneeId));
    const rows = await this.db
      .select({
        status: tickets.status,
        priority: tickets.priority,
        mailboxId: tickets.mailboxId,
        total: count(),
      })
      .from(tickets)
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(tickets.status, tickets.priority, tickets.mailboxId);
    return {
      total: rows.reduce((n, r) => n + Number(r.total), 0),
      groups: rows,
    };
  }
}
