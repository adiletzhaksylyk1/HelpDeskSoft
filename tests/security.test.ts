import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, type TestDbInstance } from "./test-db.js";
import { buildApp } from "../backend/src/app.js";
import { UsersRepository } from "../backend/src/modules/users/users.repository.js";
import { TicketsRepository } from "../backend/src/modules/tickets/tickets.repository.js";
import { StorageService } from "../backend/src/modules/storage/storage.service.js";
import { getEnvConfig } from "../backend/src/config/env.js";
import { testSession, password } from "./helpers.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
describe("Security regressions", () => {
  let db: TestDbInstance,
    app: ReturnType<typeof buildApp>,
    storage: StorageService,
    dir: string;
  beforeEach(async () => {
    db = await createTestDb();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hd-security-"));
    storage = new StorageService(db.db, dir);
    app = buildApp({ db: db.db, storageService: storage });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await db.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("rejects encoded static traversal and serves legitimate assets with CSP", async () => {
    for (const prefix of ["js", "css", "assets"])
      for (const separator of ["%2f", "%5c"])
        expect(
          (
            await app.inject(
              "/" +
                prefix +
                "/" +
                (".." + separator).repeat(5) +
                "package.json",
            )
          ).statusCode,
        ).toBe(404);
    const res = await app.inject("/");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toContain(
      "script-src 'self'",
    );
    expect(res.headers["content-security-policy"]).toContain(
      "script-src-attr 'none'",
    );
  });
  it("does not let a caller claim a new administrator or obtain an invitation through login", async () => {
    const users = new UsersRepository(db.db);
    const user = await users.create({
      name: "Admin",
      email: "admin@test.invalid",
      role: "admin",
    });
    for (const body of [
      { email: user.email },
      { email: user.email, password },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: body,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().token).toBeUndefined();
    }
    expect((await users.findById(user.id))?.passwordHash).toBeNull();
  });
  it("requires purpose, current account, and matching session version", async () => {
    const { user, token } = await testSession(app, db, "admin");
    for (const claims of [
      { id: user.id, role: "admin" },
      { id: user.id, purpose: "setup_pending", sessionVersion: 0 },
    ])
      expect(
        (
          await app.inject({
            url: "/api/tickets",
            headers: { authorization: "Bearer " + app.jwt.sign(claims) },
          })
        ).statusCode,
      ).toBe(401);
    await new UsersRepository(db.db).update(user.id, {
      isActive: false,
      role: "HelpDesk",
    });
    expect(
      (
        await app.inject({
          url: "/api/admin/users",
          headers: { authorization: "Bearer " + token },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("invalidates all sessions on logout and reset", async () => {
    const session = await testSession(app, db);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: session.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/users", headers: session.headers }))
        .statusCode,
    ).toBe(401);
  });
  it("does not exempt spoofed loopback headers from throttling", async () => {
    const statuses = [];
    for (let i = 0; i < 32; i++)
      statuses.push(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/login",
            remoteAddress: "198.51.100.4",
            headers: { "x-forwarded-for": "127.0.0.1" },
            payload: { email: "missing" + i + "@test.invalid", password },
          })
        ).statusCode,
      );
    expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(-2)).toEqual([429, 429]);
  });
  it("rejects anonymous ticket creation and forged customer replies", async () => {
    const repo = new TicketsRepository(db.db),
      ticket = await repo.create({
        senderEmail: "c@test.invalid",
        subject: "Test",
        body: "Test",
      });
    expect(
      (await app.inject({ method: "POST", url: "/api/tickets", payload: {} }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tickets/" + ticket.id + "/replies",
          payload: { sender_type: "CUSTOMER", body: "Forged" },
        })
      ).statusCode,
    ).toBe(401);
    const session = await testSession(app, db);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tickets/" + ticket.id + "/replies",
          headers: session.headers,
          payload: { sender_type: "CUSTOMER", body: "Forged" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("rejects deletion traversal before calling storage and rejects direct unsafe storage paths", async () => {
    const session = await testSession(app, db, "admin");
    const spy = vi.spyOn(storage, "deleteTicketStorage");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/tickets/..%2f..%2fsentinel",
      headers: session.headers,
    });
    expect(res.statusCode).toBe(400);
    expect(spy).not.toHaveBeenCalled();
    await expect(
      storage.deleteTicketStorage("../../sentinel"),
    ).rejects.toThrow();
  });
  it("never exposes password or invitation hashes", async () => {
    const session = await testSession(app, db, "admin");
    await new UsersRepository(db.db).issueInvitation(session.user.id);
    const second = await testSession(app, db, "admin");
    const response = await app.inject({
      url: "/api/admin/users",
      headers: second.headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("passwordHash");
    expect(response.body).not.toContain("setupTokenHash");
  });
  it("requires header authentication on downloads and sandboxes active attachment types", async () => {
    const session = await testSession(app, db),
      ticket = await new TicketsRepository(db.db).create({
        senderEmail: "a@test.invalid",
        subject: "X",
        body: "X",
      });
    const attachment = await storage.saveAttachment({
      ticketId: ticket.id,
      originalName: "test.html",
      mimeType: "text/html",
      content: Buffer.from("<script>alert(1)</script>"),
    });
    const url =
      "/api/tickets/" +
      ticket.id +
      "/attachments/" +
      attachment.id +
      "/download";
    expect((await app.inject(url + "?token=" + session.token)).statusCode).toBe(
      401,
    );
    const response = await app.inject({
      url: url + "?inline=true",
      headers: session.headers,
    });
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
  });
  it("fails production startup for placeholder secrets", () => {
    const previous = process.env.NODE_ENV,
      secret = process.env.JWT_SECRET;
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "CHANGE_ME";
    try {
      expect(() => getEnvConfig()).toThrow();
    } finally {
      process.env.NODE_ENV = previous;
      process.env.JWT_SECRET = secret;
    }
  });
});
