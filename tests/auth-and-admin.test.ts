import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbInstance } from "./test-db.js";
import { buildApp } from "../backend/src/app.js";
import { UsersRepository } from "../backend/src/modules/users/users.repository.js";
import { testSession, password } from "./helpers.js";
describe("Verified invitations and current permissions", () => {
  let db: TestDbInstance, app: ReturnType<typeof buildApp>;
  beforeEach(async () => {
    db = await createTestDb();
    app = buildApp({ db: db.db });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await db.cleanup();
  });
  it("consumes an invitation exactly once and then verifies the password", async () => {
    const users = new UsersRepository(db.db),
      user = await users.create({
        email: "new@test.invalid",
        name: "New",
        role: "HelpDesk",
      }),
      token = await users.issueInvitation(user.id);
    const body = { email: user.email, password, token };
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/setup-password",
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/setup-password",
          payload: body,
        })
      ).statusCode,
    ).toBe(401);
    const auth = response.json();
    expect(
      app.jwt.decode<{ exp: number; iat: number }>(auth.token)!.exp -
        app.jwt.decode<{ iat: number }>(auth.token)!.iat,
    ).toBe(43200);
    expect(
      (
        await app.inject({
          url: "/api/auth/me",
          headers: { authorization: "Bearer " + auth.token },
        })
      ).json().id,
    ).toBe(user.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: user.email, password: "wrong" },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { email: user.email, password },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("rejects expired and mismatched invitations", async () => {
    const users = new UsersRepository(db.db),
      user = await users.create({ email: "a@test.invalid", name: "A" }),
      other = await users.create({ email: "b@test.invalid", name: "B" }),
      token = await users.issueInvitation(user.id);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/setup-password",
          payload: { email: other.email, password, token },
        })
      ).statusCode,
    ).toBe(401);
    await db.pool.query("UPDATE users SET setup_expires_at=$1 WHERE id=$2", [
      new Date(Date.now() - 1000),
      user.id,
    ]);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/setup-password",
          payload: { email: user.email, password, token },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("enforces admin permission and protects the last active administrator", async () => {
    const admin = await testSession(app, db, "admin"),
      staff = await testSession(app, db);
    expect(
      (await app.inject({ url: "/api/admin/users", headers: staff.headers }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/admin/users/" + admin.user.id,
          headers: admin.headers,
          payload: { is_active: false },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/admin/users/" + admin.user.id,
          headers: admin.headers,
          payload: { role: "HelpDesk" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("creates roles and staff, issues invitations, updates and removes staff", async () => {
    const admin = await testSession(app, db, "admin");
    const role = await app.inject({
      method: "POST",
      url: "/api/admin/roles",
      headers: admin.headers,
      payload: { name: "Library", is_admin: false },
    });
    expect(role.statusCode).toBe(201);
    const added = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: admin.headers,
      payload: { name: "Agent", email: "agent@test.invalid", role: "Library" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().invitationToken).toHaveLength(64);
    const id = added.json().id;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/admin/users/" + id,
          headers: admin.headers,
          payload: { role: "HelpDesk" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/admin/users/" + id + "/reset-password",
          headers: admin.headers,
        })
      ).json().invitationToken,
    ).toHaveLength(64);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/admin/users/" + id,
          headers: admin.headers,
        })
      ).statusCode,
    ).toBe(200);
  });
});
