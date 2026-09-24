import { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import type { UsersRepository } from "./users.repository.js";
import { RolesRepository } from "../roles/roles.repository.js";
import { ValidationError } from "../../shared/errors.js";
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
} from "../../shared/errors.js";

const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Valid email is required"),
  role: z.string().default("HelpDesk"),
  is_active: z.boolean().default(true),
});

const listUsersQuerySchema = z.object({
  is_active: z.preprocess((val) => {
    if (val === "true") return true;
    if (val === "false") return false;
    return val;
  }, z.boolean().optional()),
});

export function registerUserRoutes(
  app: FastifyInstance,
  usersRepo: UsersRepository,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void,
): void {
  // GET /api/users - Staff only (for assignee dropdown)
  app.get("/", async (req, reply) => {
    const query = listUsersQuerySchema.parse(req.query);
    const users = await usersRepo.findAll(
      query.is_active !== undefined ? { isActive: query.is_active } : undefined,
    );
    const safeUsers = users.map(
      ({ passwordHash, setupTokenHash, setupExpiresAt, ...safe }) => safe,
    );
    return reply.status(200).send(safeUsers);
  });

  // POST /api/users (Admin only)
  app.post("/", async (req, reply) => {
    const payload = req.user as { isAdmin?: boolean };
    if (!payload?.isAdmin) {
      throw new ForbiddenError("Only administrators can create staff members");
    }

    const body = createUserSchema.parse(req.body);
    const role = await new RolesRepository(usersRepo.db).findByName(body.role);
    if (!role) throw new ValidationError("Unknown department");
    body.role = role.name;
    const existing = await usersRepo.findByEmail(body.email);
    if (existing) {
      throw new ConflictError(`User with email '${body.email}' already exists`);
    }
    const user = await usersRepo.create({
      name: body.name,
      email: body.email,
      role: body.role,
      isActive: body.is_active,
    });
    const { passwordHash, setupTokenHash, setupExpiresAt, ...safe } = user;
    return reply
      .status(201)
      .send({
        ...safe,
        invitationToken: await usersRepo.issueInvitation(user.id),
      });
  });

  done();
}
