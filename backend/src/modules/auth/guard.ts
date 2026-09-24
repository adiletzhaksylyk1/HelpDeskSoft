import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { UsersRepository } from "../users/users.repository.js";
import type { RolesRepository } from "../roles/roles.repository.js";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors.js";

export interface Principal {
  id: string;
  email: string;
  name: string;
  role: string;
  isAdmin: boolean;
  sessionVersion: number;
  purpose: "access";
}
const claims = z.object({
  id: z.string().uuid(),
  purpose: z.literal("access"),
  sessionVersion: z.number().int(),
});
export function installAuthGuard(
  app: FastifyInstance,
  users: UsersRepository,
  roles: RolesRepository,
): void {
  app.addHook("preHandler", async (req) => {
    const route = req.routeOptions.url || "";
    if (!route.startsWith("/api/")) return;
    if (route === "/api/auth/login" || route === "/api/auth/setup-password")
      return;
    try {
      await req.jwtVerify();
      const payload = claims.parse(req.user);
      const user = await users.findById(payload.id);
      if (
        !user?.isActive ||
        !user.passwordHash ||
        user.sessionVersion !== payload.sessionVersion
      )
        throw new Error("revoked");
      const role = await roles.findByName(user.role);
      if (!role) throw new Error("invalid role");
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isAdmin: role.isAdmin,
        sessionVersion: user.sessionVersion,
        purpose: "access",
      };
    } catch {
      throw new UnauthorizedError(
        "Session expired or revoked. Please sign in again.",
      );
    }
    if (route.startsWith("/api/admin/") && !(req.user as Principal).isAdmin)
      throw new ForbiddenError("Administrator access required");
    const params = req.params as Record<string, unknown>;
    for (const key of ["id", "attachmentId"])
      if (params?.[key] !== undefined) z.string().uuid().parse(params[key]);
  });
}
export function principal(req: FastifyRequest): Principal {
  return req.user as Principal;
}
