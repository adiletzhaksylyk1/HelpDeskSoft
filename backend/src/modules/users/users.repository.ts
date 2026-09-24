import crypto from "node:crypto";
import { gt } from "drizzle-orm";
import { withDbLock } from "../../db/lock.js";
import { AppError, ValidationError } from "../../shared/errors.js";
import { roles } from "../../db/schema.js";
import { eq, and, sql, count } from "drizzle-orm";
import type { AppDatabase } from "../../db/index.js";
import { users, tickets, type User, type NewUser } from "../../db/schema.js";

export interface UserWithStats extends User {
  activeTicketsCount: number;
}

export class UsersRepository {
  constructor(readonly db: AppDatabase) {}

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
        and(
          eq(tickets.assigneeId, users.id),
          sql`${tickets.status} != 'RESOLVED'`,
        ),
      )
      .groupBy(users.id)
      .orderBy(users.createdAt);

    return rows.map((r) => ({
      ...r.user,
      activeTicketsCount: Number(r.activeTicketsCount || 0),
    }));
  }

  async findById(id: string): Promise<User | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);
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

  async updatePassword(
    id: string,
    passwordHash: string | null,
  ): Promise<User | null> {
    const [updated] = await this.db
      .update(users)
      .set({
        passwordHash,
        setupTokenHash: null,
        setupExpiresAt: null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return updated || null;
  }

  async update(
    id: string,
    data: Partial<Pick<User, "name" | "email" | "role" | "isActive">>,
  ): Promise<User | null> {
    const [updated] = await this.db
      .update(users)
      .set({
        ...data,
        sessionVersion: sql`${users.sessionVersion} + 1`,
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

  async issueInvitation(id: string): Promise<string> {
    const token = crypto.randomBytes(32).toString("hex");
    await this.db
      .update(users)
      .set({
        passwordHash: null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        setupTokenHash: crypto.createHash("sha256").update(token).digest("hex"),
        setupExpiresAt: new Date(Date.now() + 3600000),
      })
      .where(eq(users.id, id));
    return token;
  }
  async resetInvitation(id: string): Promise<string> {
    return withDbLock(this.db, 740003, async (tx) => {
      const repo = new UsersRepository(tx),
        target = await repo.findById(id);
      const accounts = await tx
        .select({ user: users, role: roles })
        .from(users)
        .innerJoin(roles, eq(users.role, roles.name));
      if (
        target?.isActive &&
        accounts.find((a) => a.user.id === id)?.role.isAdmin &&
        !accounts.some(
          (a) =>
            a.user.id !== id &&
            a.user.isActive &&
            a.user.passwordHash &&
            a.role.isAdmin,
        )
      )
        throw new ValidationError(
          "Cannot reset the last initialized administrator",
        );
      return repo.issueInvitation(id);
    });
  }
  async consumeInvitation(
    email: string,
    tokenHash: string,
    hash: string,
  ): Promise<User | null> {
    const [user] = await this.db
      .update(users)
      .set({
        passwordHash: hash,
        setupTokenHash: null,
        setupExpiresAt: null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.email, email.toLowerCase().trim()),
          eq(users.setupTokenHash, tokenHash),
          eq(users.isActive, true),
          gt(users.setupExpiresAt, new Date()),
        ),
      )
      .returning();
    return user || null;
  }
  async revokeSessions(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, id));
  }
  async checkLoginAttempt(email: string): Promise<void> {
    const hash = crypto
      .createHash("sha256")
      .update(email.toLowerCase().trim())
      .digest("hex");
    const allowed = await withDbLock(this.db, 740002, async (tx) => {
      const result = await tx.execute(
        sql`SELECT attempts, window_start FROM auth_attempts WHERE email_hash=${hash}`,
      );
      const row = result.rows[0] as any;
      if (
        row &&
        Date.now() - new Date(row.window_start).getTime() < 600000 &&
        row.attempts >= 30
      )
        return false;
      if (!row)
        await tx.execute(
          sql`INSERT INTO auth_attempts(email_hash,attempts,window_start) VALUES (${hash},1,${new Date()})`,
        );
      else if (Date.now() - new Date(row.window_start).getTime() >= 600000)
        await tx.execute(
          sql`UPDATE auth_attempts SET attempts=1,window_start=${new Date()} WHERE email_hash=${hash}`,
        );
      else
        await tx.execute(
          sql`UPDATE auth_attempts SET attempts=attempts+1 WHERE email_hash=${hash}`,
        );
      await tx.execute(
        sql`DELETE FROM auth_attempts WHERE window_start < ${new Date(Date.now() - 86400000)}`,
      );
      return true;
    });
    if (!allowed)
      throw new AppError(
        "Too many attempts. Try again later.",
        429,
        "RATE_LIMITED",
      );
  }
  async clearLoginAttempts(email: string): Promise<void> {
    const hash = crypto
      .createHash("sha256")
      .update(email.toLowerCase().trim())
      .digest("hex");
    await this.db.execute(
      sql`DELETE FROM auth_attempts WHERE email_hash=${hash}`,
    );
  }
  async safeUpdate(
    id: string,
    data: Parameters<UsersRepository["update"]>[1],
    remove = false,
  ): Promise<User | null> {
    return withDbLock(this.db, 740003, async (tx) => {
      const repo = new UsersRepository(tx);
      const current = await repo.findById(id);
      if (!current) return null;
      if (data.role) {
        const [role] = await tx
          .select()
          .from(roles)
          .where(eq(roles.name, data.role));
        if (!role) throw new ValidationError("Unknown role");
      }
      const [oldRole] = await tx
        .select()
        .from(roles)
        .where(eq(roles.name, current.role));
      const [newRole] = await tx
        .select()
        .from(roles)
        .where(eq(roles.name, data.role || current.role));
      if (
        current.isActive &&
        oldRole?.isAdmin &&
        (data.isActive === false || !newRole?.isAdmin)
      ) {
        const others = await tx
          .select({ id: users.id, passwordHash: users.passwordHash })
          .from(users)
          .innerJoin(roles, eq(users.role, roles.name))
          .where(and(eq(users.isActive, true), eq(roles.isAdmin, true)));
        if (others.filter((u) => u.id !== id && u.passwordHash).length === 0)
          throw new ValidationError(
            "Cannot remove the last active administrator",
          );
      }
      if (remove) {
        await repo.delete(id);
        return current;
      }
      return repo.update(id, data);
    });
  }
}
