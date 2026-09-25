import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import type { AuthService } from "./auth.service.js";
import type { UsersRepository } from "../users/users.repository.js";
import { principal } from "./guard.js";
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().max(200).optional(),
});
const setupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(72),
  token: z.string().length(64),
});
export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  users: UsersRepository,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void,
): void {
  app.post(
    "/login",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);
      reply.header("Cache-Control", "no-store");
      return auth.login(body.email, body.password);
    },
  );
  app.post(
    "/setup-password",
    { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } },
    async (req, reply) => {
      const body = setupSchema.parse(req.body);
      reply.header("Cache-Control", "no-store");
      return auth.setupPassword(body.email, body.password, body.token);
    },
  );
  app.get("/me", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    return { ...principal(req), isActive: true };
  });
  app.post("/logout", async (req) => {
    await users.revokeSessions(principal(req).id);
    return { success: true };
  });
  done();
}
