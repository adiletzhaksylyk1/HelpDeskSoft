import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbInstance } from "./test-db.js";
import { buildApp } from "../backend/src/app.js";
import { testSession } from "./helpers.js";
import { TicketsRepository } from "../backend/src/modules/tickets/tickets.repository.js";
import { UsersRepository } from "../backend/src/modules/users/users.repository.js";
describe("Ticket API", () => {
  let db: TestDbInstance,
    app: ReturnType<typeof buildApp>,
    staff: Awaited<ReturnType<typeof testSession>>;
  beforeEach(async () => {
    db = await createTestDb();
    app = buildApp({ db: db.db });
    staff = await testSession(app, db);
  });
  afterEach(async () => {
    await app.close();
    await db.cleanup();
  });
  const payload = {
    sender_email: "customer@test.invalid",
    subject: "Printer",
    body: "Paper jam",
  };
  it("creates and retrieves an assigned ticket", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/tickets",
      headers: staff.headers,
      payload,
    });
    expect(r.statusCode).toBe(201);
    const ticket = r.json();
    expect(ticket.assigneeId).toBe(staff.user.id);
    expect(
      (
        await app.inject({
          url: "/api/tickets/" + ticket.id,
          headers: staff.headers,
        })
      ).json().assignee.id,
    ).toBe(staff.user.id);
  });
  it("returns 404 for a missing valid id and 400 for invalid ids", async () => {
    expect(
      (
        await app.inject({
          url: "/api/tickets/00000000-0000-4000-8000-000000000000",
          headers: staff.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: "/api/tickets/not-a-uuid",
          headers: staff.headers,
        })
      ).statusCode,
    ).toBe(400);
  });
  it("updates with optimistic concurrency and tracks resolution separately", async () => {
    const ticket = (
      await app.inject({
        method: "POST",
        url: "/api/tickets",
        headers: staff.headers,
        payload,
      })
    ).json();
    const update = await app.inject({
      method: "PATCH",
      url: "/api/tickets/" + ticket.id,
      headers: staff.headers,
      payload: {
        status: "RESOLVED",
        priority: "HIGH",
        version: ticket.version,
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().resolvedAt).toBeTruthy();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/tickets/" + ticket.id,
          headers: staff.headers,
          payload: { priority: "LOW", version: ticket.version },
        })
      ).statusCode,
    ).toBe(409);
    const again = await app.inject({
      method: "PATCH",
      url: "/api/tickets/" + ticket.id,
      headers: staff.headers,
      payload: { priority: "LOW", version: update.json().version },
    });
    expect(again.json().resolvedAt).toBe(update.json().resolvedAt);
  });
  it("validates reassignment and supports my tickets", async () => {
    const other = await testSession(app, db);
    const ticket = (
      await app.inject({
        method: "POST",
        url: "/api/tickets",
        headers: staff.headers,
        payload,
      })
    ).json();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/tickets/" + ticket.id + "/assign",
          headers: staff.headers,
          payload: { assignee_id: other.user.id, version: ticket.version },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/tickets?my_tickets=true",
          headers: other.headers,
        })
      ).json().data[0].id,
    ).toBe(ticket.id);
    await new UsersRepository(db.db).update(other.user.id, { isActive: false });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/tickets/" + ticket.id + "/assign",
          headers: staff.headers,
          payload: { assignee_id: other.user.id, version: 2 },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("restricts deletion to admins and preserves deduplication tombstones", async () => {
    const ticket = await new TicketsRepository(db.db).create({
      senderEmail: "c@test.invalid",
      subject: "X",
      body: "X",
      messageId: "<delete@test>",
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/tickets/" + ticket.id,
          headers: staff.headers,
        })
      ).statusCode,
    ).toBe(403);
    const admin = await testSession(app, db, "admin");
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/tickets/" + ticket.id,
          headers: admin.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await new TicketsRepository(db.db).isMessageDeleted(ticket.messageId),
    ).toBe(true);
  });
});
