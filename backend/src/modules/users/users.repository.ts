import { eq, and, sql, count } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { users, tickets, type User, type NewUser } from '../../db/schema.js';

export interface UserWithStats extends User {
  activeTicketsCount: number;
}

export class UsersRepository {
  constructor(private readonly db: AppDatabase) {}

  async findAll(filter?: { isActive?: boolean }): Promise<User[]> {
    if (filter?.isActive !== undefined) {
      return this.db
        .select()
        .from(users)
        .where(eq(users.isActive, filter.isActive));
    }
    return this.db.select().from(users);
  }

  async findAllWithStats(): Promise<UserWithStats[]> {
    const rows = await this.db
      .select({
        user: users,
        activeTicketsCount: count(tickets.id),
      })
      .from(users)
      .leftJoin(
        tickets,
        and(eq(tickets.assigneeId, users.id), sql`${tickets.status} != 'RESOLVED'`)
      )
      .groupBy(users.id)
      .orderBy(users.createdAt);

    return rows.map((r) => ({
      ...r.user,
      activeTicketsCount: Number(r.activeTicketsCount || 0),
    }));
  }

  async findById(id: string): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
    return user || null;
  }

  async create(data: NewUser): Promise<User> {
    const [created] = await this.db
      .insert(users)
      .values({
        ...data,
        email: data.email.toLowerCase().trim(),
      })
      .returning();
    return created;
  }

  async updatePassword(id: string, passwordHash: string): Promise<User | null> {
    const [updated] = await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated || null;
  }

  async update(id: string, data: Partial<Pick<User, 'name' | 'email' | 'role' | 'isActive'>>): Promise<User | null> {
    const [updated] = await this.db
      .update(users)
      .set({
        ...data,
        ...(data.email ? { email: data.email.toLowerCase().trim() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated || null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return deleted.length > 0;
  }
}
