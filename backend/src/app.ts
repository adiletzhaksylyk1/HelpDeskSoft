import fs from 'node:fs';
import path from 'node:path';
import fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { AppDatabase } from './db/index.js';
import { getDb } from './db/index.js';
import { getEnvConfig } from './config/env.js';
import { UsersRepository } from './modules/users/users.repository.js';
import { RolesRepository } from './modules/roles/roles.repository.js';
import { TicketsRepository } from './modules/tickets/tickets.repository.js';
import { TicketsService } from './modules/tickets/tickets.service.js';
import { SmtpService } from './modules/email/smtp.service.js';
import { AuthService } from './modules/auth/auth.service.js';
import { StorageService } from './modules/storage/storage.service.js';
import { registerTicketRoutes } from './modules/tickets/tickets.routes.js';
import { registerUserRoutes } from './modules/users/users.routes.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerAdminRoutes } from './modules/admin/admin.routes.js';
import { MailboxesRepository } from './modules/mailboxes/mailboxes.repository.js';
import { registerMailboxesRoutes } from './modules/mailboxes/mailboxes.routes.js';
import type { ImapWorker } from './modules/email/imap.worker.js';
import { AppError } from './shared/errors.js';
import { logger } from './shared/logger.js';

export interface BuildAppOptions {
  db?: AppDatabase;
  smtpService?: SmtpService;
  storageService?: StorageService;
  mailboxesRepo?: MailboxesRepository;
  imapWorker?: ImapWorker;
  enableLogging?: boolean;
}

export function buildApp(options: BuildAppOptions = {}) {
  const env = getEnvConfig();
  const app = fastify({
    trustProxy: true,
    logger: options.enableLogging
      ? {
        level: process.env.LOG_LEVEL || 'info',
        redact: ['password', 'secret', 'IMAP_PASSWORD', 'SMTP_PASSWORD', 'authorization'],
      }
      : false,
  });


  app.register(helmet, {
    contentSecurityPolicy: false, // Disabling CSP for now to not break the frontend inline scripts/styles if any
    crossOriginEmbedderPolicy: false
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1']
  });

  app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });

  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  // Strip Content-Type on body-less requests to avoid FST_ERR_CTP_EMPTY_JSON_BODY
  app.addHook('onRequest', async (req) => {
    if ((req.method === 'DELETE' || req.method === 'GET') && req.headers['content-type']) {
      delete req.headers['content-type'];
    }
  });

  const db = options.db || getDb();
  const usersRepo = new UsersRepository(db);
  const rolesRepo = new RolesRepository(db);
  const ticketsRepo = new TicketsRepository(db);
  const mailboxesRepo = options.mailboxesRepo || new MailboxesRepository(db);
  const smtpService = options.smtpService || new SmtpService(mailboxesRepo);
  const storageService = options.storageService || new StorageService(db);
  const ticketsService = new TicketsService(ticketsRepo, smtpService, storageService);
  const authService = new AuthService(usersRepo, (payload) =>
    app.jwt.sign(payload, { expiresIn: '12h' })
  );

  // Static assets delivery for modern SPA
  const publicDirs = [
    path.join(process.cwd(), 'backend/src/public'),
    path.join(process.cwd(), 'dist/backend/src/public'),
  ];

  const serveStaticFile = (relPath: string, reply: any, defaultMime?: string) => {
    for (const dir of publicDirs) {
      const fullPath = path.join(dir, relPath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.svg': 'image/svg+xml',
          '.html': 'text/html',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.ico': 'image/x-icon',
          '.json': 'application/json',
        };
        const contentType = mimeMap[ext] || defaultMime || 'application/octet-stream';
        return reply.type(contentType).send(fs.readFileSync(fullPath));
      }
    }
    return reply.status(404).send('Not Found');
  };

  app.get('/css/:file', async (req: any, reply) => {
    return serveStaticFile(path.join('css', req.params.file), reply, 'text/css');
  });

  app.get('/js/:file', async (req: any, reply) => {
    return serveStaticFile(path.join('js', req.params.file), reply, 'application/javascript');
  });

  app.get('/aitu_logo.svg', async (_req, reply) => {
    return serveStaticFile('aitu_logo.svg', reply, 'image/svg+xml');
  });

  app.get('/favicon.svg', async (_req, reply) => {
    return serveStaticFile('favicon.svg', reply, 'image/svg+xml');
  });

  app.get('/favicon.ico', async (_req, reply) => {
    return serveStaticFile('favicon.svg', reply, 'image/svg+xml');
  });

  app.get('/apple-touch-icon.png', async (_req, reply) => {
    return serveStaticFile('apple-touch-icon.png', reply, 'image/png');
  });

  app.get('/assets/:file', async (req: any, reply) => {
    return serveStaticFile(path.join('assets', req.params.file), reply);
  });

  app.get('/', async (req, reply) => {
    const accept = req.headers.accept || '';
    const isJsonOnly = accept.includes('application/json') && !accept.includes('text/html');
    if (!isJsonOnly) {
      const candidates = [
        path.join(process.cwd(), 'backend/src/public/index.html'),
        path.join(process.cwd(), 'dist/backend/src/public/index.html'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          return reply.type('text/html').send(fs.readFileSync(p, 'utf-8'));
        }
      }
    }

    return reply.status(200).send({
      name: 'Helpdesk API Service',
      version: '1.0.0',
      status: 'online',
      endpoints: {
        health: '/health',
        tickets: '/api/tickets',
        users: '/api/users',
        auth: '/api/auth',
        admin: '/api/admin',
      },
    });
  });

  // Healthcheck endpoint
  app.get('/health', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Register routes
  app.register((instance, opts, done) => {
    registerAuthRoutes(instance, authService, usersRepo, opts, done);
  }, { prefix: '/api/auth' });

  app.register((instance, opts, done) => {
    registerAdminRoutes(instance, usersRepo, rolesRepo, opts, done);
  }, { prefix: '/api/admin' });

  registerMailboxesRoutes(app, mailboxesRepo, options.imapWorker);

  app.register((instance, opts, done) => {
    registerTicketRoutes(instance, ticketsService, storageService, opts, done);
  }, { prefix: '/api/tickets' });

  app.register((instance, opts, done) => {
    registerUserRoutes(instance, usersRepo, opts, done);
  }, { prefix: '/api/users' });

  // Centralized error handling
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request payload or query parameters',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const errAny = error as any;
    if (error instanceof AppError || (errAny && typeof errAny.statusCode === 'number' && typeof errAny.code === 'string')) {
      return reply.status(errAny.statusCode || 400).send({
        error: errAny.code || 'ERROR',
        message: errAny.message || 'Request failed',
      });
    }

    if (
      errAny?.statusCode === 401 ||
      (typeof errAny?.code === 'string' && errAny.code.startsWith('FST_JWT'))
    ) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        message: errAny?.message || 'Authentication required',
      });
    }

    if (errAny?.code === '23505') {
      return reply.status(409).send({
        error: 'CONFLICT',
        message: 'A record with these unique details already exists',
      });
    }

    logger.error({ err: error }, 'Unhandled server error');

    // Never expose raw stack traces or internal secrets to client
    return reply.status(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
    });
  });

  return app;
}
