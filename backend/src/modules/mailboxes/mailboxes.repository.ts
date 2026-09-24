import { eq, desc, sql } from "drizzle-orm";
import type { AppDatabase } from "../../db/index.js";
import {
  mailboxes,
  roles,
  type Mailbox,
  type NewMailbox,
} from "../../db/schema.js";
import { encryptSecret, decryptSecret } from "../../shared/secrets.js";
import { withDbLock } from "../../db/lock.js";
import { ValidationError } from "../../shared/errors.js";
export type SafeMailbox = Omit<
  Mailbox,
  "imapPassword" | "smtpPassword" | "msClientSecret"
> & {
  hasImapPassword: boolean;
  hasSmtpPassword: boolean;
  hasMsClientSecret: boolean;
};
export class MailboxesRepository {
  constructor(readonly db: AppDatabase) {}
  private decode(m: Mailbox): Mailbox {
    return {
      ...m,
      imapPassword: decryptSecret(m.imapPassword) || "",
      smtpPassword: decryptSecret(m.smtpPassword) || "",
      msClientSecret: decryptSecret(m.msClientSecret),
    };
  }
  private encode(data: Partial<NewMailbox>): Partial<NewMailbox> {
    const next = { ...data };
    if (next.email) next.email = next.email.trim().toLowerCase();
    for (const key of [
      "imapPassword",
      "smtpPassword",
      "msClientSecret",
    ] as const)
      if (next[key] !== undefined) next[key] = encryptSecret(next[key]) || "";
    return next;
  }
  async findAll(): Promise<Mailbox[]> {
    return (
      await this.db.select().from(mailboxes).orderBy(desc(mailboxes.createdAt))
    ).map((m) => this.decode(m));
  }
  async findActive(): Promise<Mailbox[]> {
    return (
      await this.db.select().from(mailboxes).where(eq(mailboxes.isActive, true))
    ).map((m) => this.decode(m));
  }
  async findById(id: string): Promise<Mailbox | null> {
    const [m] = await this.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, id));
    return m ? this.decode(m) : null;
  }
  async findByEmail(email: string): Promise<Mailbox | null> {
    const [m] = await this.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.email, email.trim().toLowerCase()));
    return m ? this.decode(m) : null;
  }
  private async setRoles(
    tx: AppDatabase,
    id: string,
    target: string | null | undefined,
  ): Promise<void> {
    await tx.execute(sql`DELETE FROM mailbox_roles WHERE mailbox_id=${id}`);
    for (const name of (target || "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean)) {
      const [role] = await tx.select().from(roles).where(eq(roles.name, name));
      if (!role)
        throw new ValidationError("Unknown routing department: " + name);
      await tx.execute(
        sql`INSERT INTO mailbox_roles(mailbox_id,role_id) VALUES (${id},${role.id}) ON CONFLICT DO NOTHING`,
      );
    }
  }
  async create(
    data: Omit<NewMailbox, "id" | "createdAt" | "updatedAt">,
  ): Promise<Mailbox> {
    return withDbLock(this.db, 740003, async (tx) => {
      const [m] = await tx
        .insert(mailboxes)
        .values(this.encode(data) as NewMailbox)
        .returning();
      await this.setRoles(tx, m.id, data.targetRole);
      return this.decode(m);
    });
  }
  async update(id: string, data: Partial<NewMailbox>): Promise<Mailbox | null> {
    return withDbLock(this.db, 740003, async (tx) => {
      const [old] = await tx
        .select()
        .from(mailboxes)
        .where(eq(mailboxes.id, id));
      if (!old) return null;
      const merged = { ...this.decode(old), ...data };
      if (
        merged.isActive &&
        (merged.provider === "graph"
          ? !(merged.msTenantId && merged.msClientId && merged.msClientSecret)
          : !(merged.imapHost && merged.imapUser && merged.imapPassword))
      )
        throw new ValidationError("Mailbox credentials incomplete");
      if (data.targetRole !== undefined)
        await this.setRoles(tx, id, data.targetRole);
      const providerChanged =
        data.provider !== undefined && data.provider !== old.provider;
      const [m] = await tx
        .update(mailboxes)
        .set({
          ...this.encode(data),
          ...(providerChanged ? { syncCursor: null, uidValidity: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(mailboxes.id, id))
        .returning();
      return this.decode(m);
    });
  }
  async delete(id: string): Promise<boolean> {
    return (
      (await this.db.delete(mailboxes).where(eq(mailboxes.id, id)).returning())
        .length > 0
    );
  }
  async updateSyncStatus(id: string, error?: string | null): Promise<void> {
    await this.db
      .update(mailboxes)
      .set({ lastSyncAt: new Date(), lastSyncError: error ?? null })
      .where(eq(mailboxes.id, id));
  }
  toSafeMailbox(m: Mailbox): SafeMailbox {
    const { imapPassword, smtpPassword, msClientSecret, ...safe } = m;
    return {
      ...safe,
      hasImapPassword: !!imapPassword,
      hasSmtpPassword: !!smtpPassword,
      hasMsClientSecret: !!msClientSecret,
    };
  }
}
