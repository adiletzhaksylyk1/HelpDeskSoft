import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import type { UsersRepository } from '../users/users.repository.js';
import type { RolesRepository } from '../roles/roles.repository.js';
import { UnauthorizedError, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

const createStaffSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid corporate email is required'),
  role: z.string().min(1, 'Role / Department is required').default('HelpDesk'),
});

const updateStaffSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

const createRoleSchema = z.object({
  name: z.string().min(1, 'Role name is required'),
  description: z.string().optional(),
  is_admin: z.boolean().optional().default(false),
});

export function registerAdminRoutes(
  app: FastifyInstance,
  usersRepo: UsersRepository,
  rolesRepo: RolesRepository,
  _opts: FastifyPluginOptions,
  done: (err?: Error) => void
): void {
  // Admin Authorization Guard for all routes in this prefix
  app.addHook('preHandler', async (req) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new UnauthorizedError('Authentication token missing or invalid');
    }

    const payload = req.user as { id: string; role: string };
    if (!payload || payload.role !== 'admin') {
      throw new ForbiddenError('Administrator access required');
    }
  });

  // GET /api/admin/users - List staff with statistics
  app.get('/users', async (_req, reply) => {
    const staff = await usersRepo.findAllWithStats();
    const safeStaff = staff.map(({ passwordHash, ...safe }) => ({
      ...safe,
      hasPassword: Boolean(passwordHash),
    }));
    return reply.status(200).send(safeStaff);
  });

  // POST /api/admin/users - Add staff member with null password (setup on first login)
  app.post('/users', async (req, reply) => {
    const body = createStaffSchema.parse(req.body);
    const existing = await usersRepo.findByEmail(body.email);
    if (existing) {
      throw new ConflictError(`User with email '${body.email}' already exists`);
    }

    const created = await usersRepo.create({
      name: body.name,
      email: body.email,
      role: body.role,
      isActive: true,
      passwordHash: null,
    });

    const actor = (req.user as { email?: string })?.email;
    logger.info({ newUser: body.email, role: body.role, by: actor }, 'Staff member created');
    const { passwordHash, ...safe } = created;
    return reply.status(201).send({
      ...safe,
      hasPassword: false,
      activeTicketsCount: 0,
    });
  });

  // PATCH /api/admin/users/:id - Modify role, status, or details
  app.patch('/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateStaffSchema.parse(req.body);

    const existing = await usersRepo.findById(id);
    if (!existing) {
      throw new NotFoundError(`Staff member '${id}' not found`);
    }

    // Check duplicate email if changing email
    if (body.email && body.email.toLowerCase() !== existing.email.toLowerCase()) {
      const duplicate = await usersRepo.findByEmail(body.email);
      if (duplicate) {
        throw new ConflictError(`User with email '${body.email}' already exists`);
      }
    }

    const updated = await usersRepo.update(id, {
      name: body.name,
      email: body.email,
      role: body.role,
      isActive: body.is_active,
    });

    if (!updated) {
      throw new NotFoundError(`Staff member '${id}' not found`);
    }

    const actor = (req.user as { email?: string })?.email;
    if (body.role && body.role !== existing.role) {
      logger.info({ userId: id, fromRole: existing.role, toRole: body.role, by: actor }, 'Staff role changed');
    }

    const { passwordHash, ...safe } = updated;
    return reply.status(200).send(safe);
  });

  // DELETE /api/admin/users/:id - Delete employee
  app.delete('/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const currentUser = req.user as { id: string };

    if (currentUser.id === id) {
      throw new ValidationError('You cannot delete your own administrative account');
    }

    const existing = await usersRepo.findById(id);
    if (!existing) {
      throw new NotFoundError(`Staff member '${id}' not found`);
    }

    // Guard: prevent deleting the last active admin account
    if (existing.role === 'admin') {
      const allUsers = await usersRepo.findAll();
      const activeAdmins = allUsers.filter((u) => u.role === 'admin' && u.isActive && u.id !== id);
      if (activeAdmins.length === 0) {
        throw new ValidationError('Cannot delete the last active administrator account');
      }
    }

    await usersRepo.delete(id);
    const actor = (req.user as { email?: string })?.email;
    logger.info({ deletedUser: existing.email, role: existing.role, by: actor }, 'Staff member deleted');
    return reply.status(200).send({ success: true, message: 'User deleted successfully' });
  });

  // POST /api/admin/users/:id/reset-password - Force staff member to re-setup password on next login
  app.post('/users/:id/reset-password', async (req, reply) => {
    const { id } = req.params as { id: string };
    const currentUser = req.user as { id: string; email?: string };

    if (currentUser.id === id) {
      throw new ValidationError('You cannot reset your own password via admin — log out and use the login flow');
    }

    const existing = await usersRepo.findById(id);
    if (!existing) {
      throw new NotFoundError(`Staff member '${id}' not found`);
    }

    await usersRepo.updatePassword(id, null as any);
    logger.info({ userId: id, userEmail: existing.email, by: currentUser.email }, 'Admin reset staff password');
    return reply.status(200).send({ success: true, message: `Password reset for ${existing.name}. They will be prompted to set a new one on next login.` });
  });

  // GET /api/admin/roles - List all roles with assigned user count
  app.get('/roles', async (_req, reply) => {
    const allRoles = await rolesRepo.findAllWithUserCount();
    return reply.status(200).send(allRoles);
  });

  // POST /api/admin/roles - Create custom role/department
  app.post('/roles', async (req, reply) => {
    const body = createRoleSchema.parse(req.body);
    const existing = await rolesRepo.findByName(body.name);
    if (existing) {
      throw new ConflictError(`Role '${body.name.trim()}' already exists`);
    }

    const created = await rolesRepo.create({
      name: body.name,
      description: body.description,
      isAdmin: body.is_admin,
    });

    return reply.status(201).send(created);
  });

  // DELETE /api/admin/roles/:id - Delete custom role (supports ?reassign=true to reassign users to fallback role)
  app.delete('/roles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reassign } = req.query as { reassign?: string };
    const role = await rolesRepo.findById(id);
    if (!role) {
      throw new NotFoundError(`Role '${id}' not found`);
    }

    if (role.name === 'admin') {
      throw new ValidationError(`Cannot delete built-in system role 'admin'`);
    }

    try {
      await rolesRepo.delete(id, reassign === 'true' || reassign === '1');
      const actor = (req.user as { email?: string })?.email;
      logger.info({ roleId: id, roleName: role.name, reassign: reassign === 'true', by: actor }, 'Role deleted');
      return reply.status(200).send({ success: true, message: `Role '${role.name}' deleted successfully` });
    } catch (err: any) {
      throw new ValidationError(err.message || 'Failed to delete role');
    }
  });

  done();
}
