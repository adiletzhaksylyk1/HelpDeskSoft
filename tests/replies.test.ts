import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDbInstance } from "./test-db.js";
import { buildApp } from "../backend/src/app.js";
import { testSession } from "./helpers.js";
import { SmtpService } from "../backend/src/modules/email/smtp.service.js";
import { OutboxWorker } from "../backend/src/modules/email/outbox.worker.js";
import { StorageService } from "../backend/src/modules/storage/storage.service.js";
import { TicketsRepository } from "../backend/src/modules/tickets/tickets.repository.js";
import { ImapWorker } from "../backend/src/modules/email/imap.worker.js";
describe("Durable replies and delivery", () => {
  let db: TestDbInstance,
    app: ReturnType<typeof buildApp>,
    smtp: SmtpService,
    storage: StorageService,
    outbox: OutboxWorker,
    dir: string,
    staff: Awaited<ReturnType<typeof testSession>>;
  beforeEach(async () => {
    db = await createTestDb();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-reply-"));
    storage = new StorageService(db.db, dir);
    smtp = new SmtpService();
    smtp.validateMailbox = vi.fn().mockResolvedValue(undefined);
    smtp.sendReply = vi
      .fn()
      .mockImplementation(async (opts) => ({
        messageId: opts.messageId,
        accepted: [opts.to],
      }));
    app = buildApp({ db: db.db, storageService: storage, smtpService: smtp });
    staff = await testSession(app, db);
    outbox = new OutboxWorker(db.db, smtp, storage);
  });
  afterEach(async () => {
    await outbox.stop();
    await app.close();
    await db.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  async function ticket() {
    return new TicketsRepository(db.db).create({
      senderEmail: "customer@test.invalid",
      subject: "WiFi",
      body: "Offline",
      messageId: "<original@test>",
    });
  }
  it("persists before dispatch, deduplicates submissions and threads customer follow-ups", async () => {
    const t = await ticket(),
      key = crypto.randomUUID();
    const request = {
      method: "POST" as const,
      url: "/api/tickets/" + t.id + "/replies",
      headers: { ...staff.headers, "idempotency-key": key },
      payload: {
        body: "Try reconnecting",
        sender_type: "EMPLOYEE",
        author_name: "Forged Name",
      },
    };
    const response = await app.inject(request);
    expect(response.statusCode).toBe(201);
    expect(response.json().deliveryStatus).toBe("pending");
    expect(response.json().authorName).toBe(staff.user.name);
    expect(smtp.sendReply).not.toHaveBeenCalled();
    const repeated = await app.inject(request);
    expect(repeated.json().id).toBe(response.json().id);
    await outbox.process();
    expect(smtp.sendReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(smtp.sendReply).mock.calls[0][0].inReplyToMessageId).toBe(
      t.messageId,
    );
    await outbox.process();
    expect(smtp.sendReply).toHaveBeenCalledTimes(1);
    await new ImapWorker(
      new TicketsRepository(db.db),
      storage,
    ).processIncomingMail(
      "From: customer@test.invalid\r\nMessage-ID: <followup@test>\r\nIn-Reply-To: " +
        response.json().messageId +
        "\r\n\r\nThank you",
    );
    const thread = await new TicketsRepository(db.db).findById(t.id);
    expect(thread?.replies).toHaveLength(2);
    expect(thread?.status).toBe("WAITING");
    expect(thread?.replies?.[0].deliveryStatus).toBe("sent");
    expect((await new TicketsRepository(db.db).findMany()).total).toBe(1);
  });
  it("streams an 800KB attachment, associates it with a reply, and dispatches its exact bytes", async () => {
    const t = await ticket(),
      bytes = Buffer.alloc(800000, 42);
    const upload = await app.inject({
      method: "POST",
      url: "/api/tickets/" + t.id + "/uploads",
      headers: {
        ...staff.headers,
        "content-type": "application/octet-stream",
        "x-filename": "guide.bin",
        "idempotency-key": crypto.randomUUID(),
      },
      payload: bytes,
    });
    expect(upload.statusCode).toBe(201);
    const response = await app.inject({
      method: "POST",
      url: "/api/tickets/" + t.id + "/replies",
      headers: { ...staff.headers, "idempotency-key": crypto.randomUUID() },
      payload: { body: "See guide", attachment_ids: [upload.json().id] },
    });
    expect(response.statusCode).toBe(201);
    await outbox.process();
    expect(
      vi
        .mocked(smtp.sendReply)
        .mock.calls[0][0].attachments?.[0].content.equals(bytes),
    ).toBe(true);
    expect((await storage.findById(upload.json().id))?.replyId).toBe(
      response.json().id,
    );
  });
  it("marks ambiguous sends uncertain and does not automatically resend", async () => {
    const t = await ticket();
    smtp.sendReply = vi
      .fn()
      .mockRejectedValue(new Error("Socket closed after DATA"));
    const response = await app.inject({
      method: "POST",
      url: "/api/tickets/" + t.id + "/replies",
      headers: { ...staff.headers, "idempotency-key": crypto.randomUUID() },
      payload: { body: "Update" },
    });
    await outbox.process();
    await outbox.process();
    expect(smtp.sendReply).toHaveBeenCalledTimes(1);
    expect(
      (await new TicketsRepository(db.db).findById(t.id))?.replies?.[0]
        .deliveryStatus,
    ).toBe("uncertain");
    const retry = {
      method: "POST" as const,
      url: "/api/tickets/" + t.id + "/replies/" + response.json().id + "/retry",
      headers: staff.headers,
    };
    expect(
      (
        await app.inject({
          ...retry,
          payload: { confirmPossibleDuplicate: false },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          ...retry,
          payload: { confirmPossibleDuplicate: true },
        })
      ).json().deliveryStatus,
    ).toBe("pending");
  });
  it("rejects blank replies and prevents dispatch when persistence fails", async () => {
    const t = await ticket();
    const request = {
      method: "POST" as const,
      url: "/api/tickets/" + t.id + "/replies",
      headers: { ...staff.headers, "idempotency-key": crypto.randomUUID() },
    };
    expect(
      (await app.inject({ ...request, payload: { body: "  " } })).statusCode,
    ).toBe(400);
    vi.spyOn(TicketsRepository.prototype, "createReply").mockRejectedValueOnce(
      new Error("Database unavailable"),
    );
    expect(
      (await app.inject({ ...request, payload: { body: "Update" } }))
        .statusCode,
    ).toBe(500);
    expect(smtp.sendReply).not.toHaveBeenCalled();
  });
});
