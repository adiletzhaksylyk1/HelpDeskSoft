import { eq, desc } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { mailboxes, type Mailbox, type NewMailbox } from '../../db/schema.js';

export type SafeMailbox = Omit<Mailbox, 'imapPassword' | 'smtpPassword' | 'msClientSecret'> & {
  hasImapPassword: boolean;
  hasSmtpPassword: boolean;
  hasMsClientSecret: boolean;
};

export class MailboxesRepository {
  constructor(private readonly db: AppDatabase) {}

  async findAll(): Promise<Mailbox[]> {
    return this.db
      .select()
      .from(mailboxes)
      .orderBy(desc(mailboxes.createdAt));
  }

  async findActive(): Promise<Mailbox[]> {
    return this.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.isActive, true))
      .orderBy(desc(mailboxes.createdAt));
  }

  async findById(id: string): Promise<Mailbox | null> {
    const [item] = await this.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, id))
      .limit(1);
    return item || null;
  }

  async findByEmail(email: string): Promise<Mailbox | null> {
    const [item] = await this.db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.email, email.toLowerCase().trim()))
      .limit(1);
    return item || null;
  }

  async create(data: Omit<NewMailbox, 'id' | 'createdAt' | 'updatedAt'>): Promise<Mailbox> {
    const [item] = await this.db
      .insert(mailboxes)
      .values({
        ...data,
        email: data.email.toLowerCase().trim(),
        provider: data.provider || 'imap',
        targetRole: data.targetRole ? data.targetRole.trim() : null,
        msTenantId: data.msTenantId ? data.msTenantId.trim() : null,
        msClientId: data.msClientId ? data.msClientId.trim() : null,
        msClientSecret: data.msClientSecret ? data.msClientSecret.trim() : null,
        imapHost: data.imapHost ? data.imapHost.trim() : '',
        imapUser: data.imapUser ? data.imapUser.trim() : '',
        imapPassword: data.imapPassword ? data.imapPassword.trim() : '',
        smtpHost: data.smtpHost ? data.smtpHost.trim() : '',
        smtpUser: data.smtpUser ? data.smtpUser.trim() : '',
        smtpPassword: data.smtpPassword ? data.smtpPassword.trim() : '',
      })
      .returning();
    return item;
  }

  async update(id: string, data: Partial<NewMailbox>): Promise<Mailbox | null> {
    const updatePayload: Record<string, any> = {
      ...data,
      updatedAt: new Date(),
    };
    if (data.email) updatePayload.email = data.email.toLowerCase().trim();
    if (data.targetRole !== undefined) updatePayload.targetRole = data.targetRole ? data.targetRole.trim() : null;
    if (data.imapUser !== undefined) updatePayload.imapUser = data.imapUser.trim();
    if (data.smtpUser !== undefined) updatePayload.smtpUser = data.smtpUser.trim();
    if (data.msTenantId !== undefined) updatePayload.msTenantId = data.msTenantId?.trim() ?? null;
    if (data.msClientId !== undefined) updatePayload.msClientId = data.msClientId?.trim() ?? null;
    if (data.msClientSecret !== undefined) updatePayload.msClientSecret = data.msClientSecret?.trim() ?? null;

    const [updated] = await this.db
      .update(mailboxes)
      .set(updatePayload)
      .where(eq(mailboxes.id, id))
      .returning();
    return updated || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .delete(mailboxes)
      .where(eq(mailboxes.id, id))
      .returning({ id: mailboxes.id });
    return result.length > 0;
  }

  async updateSyncStatus(id: string, error?: string | null): Promise<void> {
    await this.db
      .update(mailboxes)
      .set({
        lastSyncAt: new Date(),
        lastSyncError: error ?? null,
      })
      .where(eq(mailboxes.id, id));
  }

  toSafeMailbox(mailbox: Mailbox): SafeMailbox {
    const { imapPassword, smtpPassword, msClientSecret, ...safe } = mailbox;
    return {
      ...safe,
      hasImapPassword: Boolean(imapPassword),
      hasSmtpPassword: Boolean(smtpPassword),
      hasMsClientSecret: Boolean(msClientSecret),
    };
  }
}
