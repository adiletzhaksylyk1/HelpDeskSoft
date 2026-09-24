import { eq, sql, count, desc } from "drizzle-orm";
import type { AppDatabase } from "../../db/index.js";
import { roles, users, mailboxes, type Role } from "../../db/schema.js";
import { withDbLock } from "../../db/lock.js";
import { ValidationError } from "../../shared/errors.js";

export interface RoleWithStats extends Role {
  userCount: number;
}

export class RolesRepository {
  constructor(private readonly db: AppDatabase) {}

  async findAllWithUserCount(): Promise<RoleWithStats[]> {
    const rows = await this.db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
        isAdmin: roles.isAdmin,
        isSystem: roles.isSystem,
        createdAt: roles.createdAt,
        updatedAt: roles.updatedAt,
        userCount: count(users.id),
      })
      .from(roles)
      .leftJoin(users, eq(users.role, roles.name))
      .groupBy(
        roles.id,
        roles.name,
        roles.description,
        roles.isAdmin,
        roles.isSystem,
        roles.createdAt,
        roles.updatedAt,
      )
      .orderBy(desc(roles.isSystem), roles.name);

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      isAdmin: r.isAdmin,
      isSystem: r.isSystem,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      userCount: Number(r.userCount || 0),
    }));
  }

  async findById(id: string): Promise<Role | null> {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(eq(roles.id, id))
      .limit(1);
    return role || null;
  }

  async findByName(name: string): Promise<Role | null> {
    const trimmed = name.trim().toLowerCase();
    const all = await this.db.select().from(roles);
    return all.find((r) => r.name.trim().toLowerCase() === trimmed) || null;
  }

  async create(data: {
    name: string;
    description?: string;
    isAdmin?: boolean;
  }): Promise<Role> {
    const trimmedName = data.name.trim();
    const [created] = await this.db
      .insert(roles)
      .values({
        name: trimmedName,
        description: data.description?.trim() || "",
        isAdmin: Boolean(data.isAdmin),
        isSystem: false,
      })
      .returning();
    return created;
  }

  async delete(id: string, reassignUsers: boolean = false): Promise<boolean> {
    return withDbLock(this.db, 740003, async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, id));
      if (!role) return false;
      if (role.isSystem || role.isAdmin || role.name === "HelpDesk")
        throw new ValidationError(
          "System and administrator roles cannot be deleted",
        );
      const assigned = await tx
        .select()
        .from(users)
        .where(eq(users.role, role.name));
      const affected = (await tx.select().from(mailboxes)).filter((m) =>
        (m.targetRole || "")
          .split(",")
          .map((s) => s.trim())
          .includes(role.name),
      );
      if ((assigned.length || affected.length) && !reassignUsers)
        throw new ValidationError(
          "Role is used by staff or mailbox routing. Confirm reassignment to HelpDesk.",
        );
      const [fallback] = await tx
        .select()
        .from(roles)
        .where(eq(roles.name, "HelpDesk"));
      if (!fallback)
        throw new ValidationError("HelpDesk fallback department is missing");
      await tx
        .update(users)
        .set({
          role: fallback.name,
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(eq(users.role, role.name));
      for (const mailbox of affected) {
        const names = [
          ...new Set(
            (mailbox.targetRole || "")
              .split(",")
              .map((s) => (s.trim() === role.name ? fallback.name : s.trim()))
              .filter(Boolean),
          ),
        ];
        await tx
          .update(mailboxes)
          .set({ targetRole: names.join(",") })
          .where(eq(mailboxes.id, mailbox.id));
        await tx.execute(
          sql`INSERT INTO mailbox_roles(mailbox_id,role_id) VALUES (${mailbox.id},${fallback.id}) ON CONFLICT DO NOTHING`,
        );
      }
      await tx.execute(sql`DELETE FROM mailbox_roles WHERE role_id=${role.id}`);
      return (
        (await tx.delete(roles).where(eq(roles.id, id)).returning()).length > 0
      );
    });
  }
}
