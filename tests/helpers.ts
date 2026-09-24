import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import type { TestDbInstance } from "./test-db.js";
import { UsersRepository } from "../backend/src/modules/users/users.repository.js";
export const password = "TestPassword123!";
const hashed = bcrypt.hash(password, 12);
export async function testSession(
  app: FastifyInstance,
  testDb: TestDbInstance,
  role = "HelpDesk",
) {
  await app.ready();
  const user = await new UsersRepository(testDb.db).create({
    name: "Test " + role,
    email: crypto.randomUUID() + "@test.invalid",
    role,
    passwordHash: await hashed,
    isActive: true,
  });
  const token = app.jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      purpose: "access",
      sessionVersion: user.sessionVersion,
    },
    { expiresIn: "12h" },
  );
  return { user, token, headers: { authorization: "Bearer " + token } };
}
