import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import type { MailboxesRepository } from './mailboxes.repository.js';
import type { ImapWorker } from '../email/imap.worker.js';
import { graphService } from '../email/graph.service.js';
import { UnauthorizedError, ForbiddenError, NotFoundError, ConflictError } from '../../shared/errors.js';

const createMailboxSchema = z.object({
  name: z.string().min(1, 'Display name is required'),
  email: z.string().email('Valid email address is required'),
  provider: z.enum(['imap', 'graph']).default('imap'),
  // Microsoft 365 Graph
  msTenantId: z.string().optional(),
  msClientId: z.string().optional(),
  msClientSecret: z.string().optional(),
  // IMAP / SMTP
  imapHost: z.string().optional().default(''),
  imapPort: z.coerce.number().optional().default(993),
  imapUser: z.string().optional().default(''),
  imapPassword: z.string().optional().default(''),
  imapSecure: z.boolean().optional().default(true),
  smtpHost: z.string().optional().default(''),
  smtpPort: z.coerce.number().optional().default(587),
  smtpUser: z.string().optional().default(''),
  smtpPassword: z.string().optional().default(''),
  smtpSecure: z.boolean().optional().default(false),
  isActive: z.boolean().default(true),
  targetRole: z.string().nullable().optional(),
  target_role: z.string().nullable().optional(),
}).refine((d) => {
  if (d.provider === 'graph') {
    return Boolean(d.msTenantId && d.msClientId && d.msClientSecret);
  }
  return Boolean(d.imapHost && d.imapUser && d.imapPassword);
}, {
  message: 'Please complete all required fields for the selected mailbox provider',
});

const updateMailboxSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  provider: z.enum(['imap', 'graph']).optional(),
  targetRole: z.string().nullable().optional(),
  target_role: z.string().nullable().optional(),
  msTenantId: z.string().optional(),
  msClientId: z.string().optional(),
  msClientSecret: z.string().optional(),
  imapHost: z.string().optional(),
  imapPort: z.coerce.number().optional(),
  imapUser: z.string().optional(),
  imapPassword: z.string().optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpSecure: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const testConnectionSchema = z.object({
  email: z.string().email('Valid email is required'),
  provider: z.enum(['imap', 'graph']).default('imap'),
  msTenantId: z.string().optional(),
  msClientId: z.string().optional(),
  msClientSecret: z.string().optional(),
  imapHost: z.string().optional(),
  imapPort: z.coerce.number().optional(),
  imapUser: z.string().optional(),
  imapPassword: z.string().optional(),
  imapSecure: z.boolean().optional(),
});

export function registerMailboxesRoutes(
  app: FastifyInstance,
  mailboxesRepo: MailboxesRepository,
  imapWorker?: ImapWorker
): void {
  // Public list of active channels for sidebar filter
  app.get('/api/mailboxes', async (_req, reply) => {
    const active = await mailboxesRepo.findActive();
    const channels = active.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      provider: m.provider,
    }));
    return reply.status(200).send(channels);
  });

  // Admin routes
  app.register((adminScope, _opts, done) => {
    adminScope.addHook('preHandler', async (req) => {
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

    // GET /api/admin/mailboxes
    adminScope.get('/', async (_req, reply) => {
      const all = await mailboxesRepo.findAll();
      const safe = all.map((m) => mailboxesRepo.toSafeMailbox(m));
      return reply.status(200).send(safe);
    });

    // POST /api/admin/mailboxes/test-connection
    adminScope.post('/test-connection', async (req, reply) => {
      const body = testConnectionSchema.parse(req.body);
      if (body.provider === 'graph') {
        if (!body.msTenantId || !body.msClientId || !body.msClientSecret) {
          return reply.status(400).send({
            success: false,
            message: 'Tenant ID, Client ID, and Client Secret are required for Microsoft 365',
          });
        }
        const result = await graphService.testConnection({
          tenantId: body.msTenantId,
          clientId: body.msClientId,
          clientSecret: body.msClientSecret,
          mailboxEmail: body.email,
        });
        return reply.status(200).send(result);
      }

      // IMAP test connection
      return reply.status(200).send({
        success: true,
        message: 'IMAP parameters format is valid',
      });
    });

    // POST /api/admin/mailboxes
    adminScope.post('/', async (req, reply) => {
      const body = createMailboxSchema.parse(req.body);
      const existing = await mailboxesRepo.findByEmail(body.email);
      if (existing) {
        throw new ConflictError(`Mailbox with email '${body.email}' already exists`);
      }

      const created = await mailboxesRepo.create({
        name: body.name,
        email: body.email,
        provider: body.provider,
        targetRole: body.targetRole || body.target_role || null,
        msTenantId: body.msTenantId || null,
        msClientId: body.msClientId || null,
        msClientSecret: body.msClientSecret || null,
        imapHost: body.imapHost || '',
        imapPort: body.imapPort || 993,
        imapUser: body.imapUser || '',
        imapPassword: body.imapPassword || '',
        imapSecure: body.imapSecure ?? true,
        smtpHost: body.smtpHost || '',
        smtpPort: body.smtpPort || 587,
        smtpUser: body.smtpUser || '',
        smtpPassword: body.smtpPassword || '',
        smtpSecure: body.smtpSecure ?? false,
        isActive: body.isActive,
        lastSyncAt: null,
        lastSyncError: null,
      });

      return reply.status(201).send(mailboxesRepo.toSafeMailbox(created));
    });

    // PATCH /api/admin/mailboxes/:id
    adminScope.patch('/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = updateMailboxSchema.parse(req.body);

      const existing = await mailboxesRepo.findById(id);
      if (!existing) {
        throw new NotFoundError(`Mailbox '${id}' not found`);
      }

      if (body.email && body.email.toLowerCase() !== existing.email.toLowerCase()) {
        const dup = await mailboxesRepo.findByEmail(body.email);
        if (dup) {
          throw new ConflictError(`Mailbox with email '${body.email}' already exists`);
        }
      }

      const payload: any = { ...body };
      if (body.target_role !== undefined) {
        payload.targetRole = body.target_role;
      }
      const updated = await mailboxesRepo.update(id, payload);
      if (!updated) {
        throw new NotFoundError(`Mailbox '${id}' not found`);
      }

      return reply.status(200).send(mailboxesRepo.toSafeMailbox(updated));
    });

    // DELETE /api/admin/mailboxes/:id
    adminScope.delete('/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      const deleted = await mailboxesRepo.delete(id);
      if (!deleted) {
        throw new NotFoundError(`Mailbox '${id}' not found`);
      }
      return reply.status(200).send({ success: true, message: 'Mailbox removed' });
    });

    // POST /api/admin/mailboxes/:id/sync - Trigger manual IMAP connection & sync
    adminScope.post('/:id/sync', async (req, reply) => {
      const { id } = req.params as { id: string };
      const mailbox = await mailboxesRepo.findById(id);
      if (!mailbox) {
        throw new NotFoundError(`Mailbox '${id}' not found`);
      }

      if (!imapWorker) {
        return reply.status(200).send({ success: false, message: 'IMAP worker not running' });
      }

      try {
        const count = await imapWorker.fetchAndProcessMailbox(mailbox);
        const updated = await mailboxesRepo.findById(id);
        return reply.status(200).send({
          success: true,
          processedCount: count,
          mailbox: updated ? mailboxesRepo.toSafeMailbox(updated) : undefined,
          message: `Sync completed. ${count} new ticket(s) ingested.`,
        });
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        return reply.status(200).send({
          success: false,
          error: errorMsg,
          message: `Sync failed: ${errorMsg}`,
        });
      }
    });

    done();
  }, { prefix: '/api/admin/mailboxes' });
}
