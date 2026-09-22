import crypto from 'node:crypto';
import { eq, and, sql, desc, count, isNull } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import {
  tickets,
  ticketReplies,
  users,
  deletedTickets,
  mailboxes,
  type Ticket,
  type NewTicket,
  type TicketReply,
  type NewTicketReply,
  type TicketStatus,
  type TicketPriority,
  type DeletedTicket,
  type NewDeletedTicket,
} from '../../db/schema.js';

export interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  assigneeId?: string | null;
  mailboxId?: string;
  recipientEmail?: string;
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
}

export class TicketsRepository {
  constructor(private readonly db: AppDatabase) { }

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

    const replies = await this.findRepliesByTicketId(id);

    return {
      ...ticket,
      assignee,
      replies,
    };
  }

  async findMany(
    filters: TicketFilters = {},
    pagination: PaginationParams = {}
  ): Promise<PaginatedResult<TicketWithDetails>> {
    const page = Math.max(1, pagination.page || 1);
    const limit = Math.min(100, Math.max(1, pagination.limit || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
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
        ticket: tickets,
        assignee: {
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(tickets)
      .leftJoin(users, eq(tickets.assigneeId, users.id))
      .where(whereClause)
      .orderBy(desc(tickets.createdAt))
      .limit(limit)
      .offset(offset);

    const formattedData: TicketWithDetails[] = items.map(({ ticket, assignee }) => ({
      ...ticket,
      assignee: assignee?.id ? assignee : null,
    }));

    return {
      data: formattedData,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findLeastBusyActiveEmployeeId(txOrRole?: AppDatabase | string | null, targetRole?: string | null): Promise<string | null> {
    let client: AppDatabase = this.db;
    let effectiveTargetRole: string | null | undefined = targetRole;

    if (typeof txOrRole === 'string') {
      effectiveTargetRole = txOrRole;
    } else if (txOrRole && typeof (txOrRole as any).execute === 'function') {
      client = txOrRole;
    }

    // 1. If targetRole is specified, try to find an active user with that specific role (or any of the multiple selected roles)
    if (effectiveTargetRole && effectiveTargetRole.trim()) {
      const roles = effectiveTargetRole.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);

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
        const roleRows = Array.isArray(roleResult) ? roleResult : (roleResult as any)?.rows;
        if (roleRows && roleRows.length > 0 && roleRows[0].id) {
          return roleRows[0].id;
        }
      } else if (roles.length > 1) {
        const roleInSql = sql.join(roles.map((r) => sql`${r}`), sql`, `);
        const roleResult = await client.execute(sql`
          SELECT u.id, COUNT(t.id) as active_count
          FROM users u
          LEFT JOIN tickets t ON t.assignee_id = u.id AND t.status != 'RESOLVED'
          WHERE u.is_active = true AND LOWER(u.role) IN (${roleInSql})
          GROUP BY u.id, u.role
          ORDER BY active_count ASC, u.id ASC
          LIMIT 1
        `);
        const roleRows = Array.isArray(roleResult) ? roleResult : (roleResult as any)?.rows;
        if (roleRows && roleRows.length > 0 && roleRows[0].id) {
          return roleRows[0].id;
        }
      }
    }

    // 2. Fallback: Select active user with least non-resolved tickets
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
    data: Omit<NewTicket, 'id' | 'createdAt' | 'updatedAt' | 'messageId'> & { messageId?: string },
    tx?: AppDatabase
  ): Promise<Ticket> {
    const client = tx || this.db;

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

    const messageId = data.messageId || `<${crypto.randomUUID()}@generated.local>`;

    const [created] = await client
      .insert(tickets)
      .values({
        ...data,
        messageId,
        assigneeId,
      })
      .returning();

    return created;
  }

  async update(id: string, updates: Partial<Pick<Ticket, 'status' | 'priority' | 'assigneeId'>>): Promise<Ticket | null> {
    const [updated] = await this.db
      .update(tickets)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, id))
      .returning();

    return updated || null;
  }

  async createReply(data: Omit<NewTicketReply, 'id' | 'createdAt'>): Promise<TicketReply> {
    const [reply] = await this.db
      .insert(ticketReplies)
      .values(data)
      .returning();

    return reply;
  }

  async findRepliesByTicketId(ticketId: string): Promise<TicketReply[]> {
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
      .orderBy(ticketReplies.createdAt);

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

    await this.db
      .insert(deletedTickets)
      .values({
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

  async findDeletedByMessageId(messageId: string): Promise<DeletedTicket | null> {
    if (!messageId) return null;
    const [deleted] = await this.db
      .select()
      .from(deletedTickets)
      .where(eq(deletedTickets.messageId, messageId))
      .limit(1);
    return deleted || null;
  }
}


