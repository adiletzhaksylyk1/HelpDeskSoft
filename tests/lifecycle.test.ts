import { it, expect, vi } from "vitest";
import { createTestDb } from "./test-db.js";
import { StorageService } from "../backend/src/modules/storage/storage.service.js";
import { CleanupWorker } from "../backend/src/modules/cleanup/cleanup.worker.js";
import { TicketsRepository } from "../backend/src/modules/tickets/tickets.repository.js";
import { MailboxesRepository } from "../backend/src/modules/mailboxes/mailboxes.repository.js";
import { RolesRepository } from "../backend/src/modules/roles/roles.repository.js";
import { UsersRepository } from "../backend/src/modules/users/users.repository.js";
import { tickets } from "../backend/src/db/schema.js";
import { eq } from "drizzle-orm";
it("retries failed deletions and does not postpone expiry when another field changes", async () => {
  const db = await createTestDb();
  try {
    const storage = new StorageService(db.db),
      repo = new TicketsRepository(db.db),
      cleanup = new CleanupWorker(db.db, storage, 24);
    const ticket = await repo.create({
      senderEmail: "customer@test",
      subject: "Resolved",
      body: "Body",
      status: "RESOLVED",
    });
    const resolvedAt = new Date(Date.now() - 48 * 3600000);
    await db.db
      .update(tickets)
      .set({ resolvedAt })
      .where(eq(tickets.id, ticket.id));
    const attachment = await storage.saveAttachment({
      ticketId: ticket.id,
      originalName: "file",
      mimeType: "text/plain",
      content: Buffer.from("data"),
    });
    const deletion = vi
      .spyOn(storage, "deletePhysicalFile")
      .mockResolvedValueOnce("failed");
    await repo.update(ticket.id, { priority: "HIGH" });
    expect((await repo.findById(ticket.id))?.resolvedAt).toEqual(resolvedAt);
    expect(await cleanup.purgeExpiredAttachments()).toEqual({
      purgedCount: 0,
      bytesFreed: 0,
    });
    expect((await storage.findById(attachment.id))?.isPurged).toBe(false);
    deletion.mockRestore();
    expect(await cleanup.purgeExpiredAttachments()).toEqual({
      purgedCount: 1,
      bytesFreed: 4,
    });
    await repo.update(ticket.id, { status: "WAITING" });
    expect((await repo.findById(ticket.id))?.resolvedAt).toBeNull();
  } finally {
    await db.cleanup();
  }
});
it("reassigns role references atomically and preserves credential whitespace encrypted at rest", async () => {
  const db = await createTestDb();
  try {
    const roles = new RolesRepository(db.db),
      users = new UsersRepository(db.db),
      mailboxes = new MailboxesRepository(db.db);
    const role = await roles.create({ name: "Routing" }),
      user = await users.create({
        name: "Agent",
        email: "agent@test",
        role: role.name,
      });
    const mailbox = await mailboxes.create({
      name: "Inbox",
      email: "inbox@test",
      imapHost: "imap.test",
      imapUser: "inbox",
      imapPassword: " secret with spaces ",
      targetRole: role.name,
    });
    const raw = await db.pool.query(
      "SELECT imap_password FROM mailboxes WHERE id=$1",
      [mailbox.id],
    );
    expect(raw.rows[0].imap_password).toMatch(/^enc:v1:/);
    expect((await mailboxes.findById(mailbox.id))?.imapPassword).toBe(
      " secret with spaces ",
    );
    await expect(roles.delete(role.id)).rejects.toThrow("Role is used");
    expect(await roles.delete(role.id, true)).toBe(true);
    expect((await users.findById(user.id))?.role).toBe("HelpDesk");
    expect((await mailboxes.findById(mailbox.id))?.targetRole).toBe("HelpDesk");
  } finally {
    await db.cleanup();
  }
});
