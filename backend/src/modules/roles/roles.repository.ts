import { eq, sql, count, desc } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { roles, users, type Role, type NewRole } from '../../db/schema.js';

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
        roles.updatedAt
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
    const [role] = await this.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    return role || null;
  }

  async findByName(name: string): Promise<Role | null> {
    const trimmed = name.trim().toLowerCase();
    const all = await this.db.select().from(roles);
    return all.find((r) => r.name.trim().toLowerCase() === trimmed) || null;
  }

  async create(data: { name: string; description?: string; isAdmin?: boolean }): Promise<Role> {
    const trimmedName = data.name.trim();
    const [created] = await this.db
      .insert(roles)
      .values({
        name: trimmedName,
        description: data.description?.trim() || '',
        isAdmin: Boolean(data.isAdmin),
        isSystem: false,
      })
      .returning();
    return created;
  }

  async delete(id: string, reassignUsers: boolean = false): Promise<boolean> {
    const role = await this.findById(id);
    if (!role) return false;
    if (role.name === 'admin' || (role.isSystem && role.name === 'admin')) {
      throw new Error(`Cannot delete built-in system role 'admin'`);
    }

    const assigned = await this.db
      .select({ count: count(users.id) })
      .from(users)
      .where(eq(users.role, role.name));
    const userCount = Number(assigned[0]?.count || 0);

    if (userCount > 0 && !reassignUsers) {
      throw new Error(`Cannot delete role '${role.name}' because ${userCount} staff member(s) are assigned to it. Reassign staff first or confirm deletion.`);
    }

    if (userCount > 0 && reassignUsers) {
      const remainingRoles = await this.db
        .select()
        .from(roles)
        .where(eq(roles.isAdmin, false));
      const fallbackRole = remainingRoles.find((r) => r.id !== id)?.name || 'HelpDesk';
      await this.db
        .update(users)
        .set({ role: fallbackRole })
        .where(eq(users.role, role.name));
    }

    const deleted = await this.db
      .delete(roles)
      .where(eq(roles.id, id))
      .returning({ id: roles.id });

    return deleted.length > 0;
  }
}
