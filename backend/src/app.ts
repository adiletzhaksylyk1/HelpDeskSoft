import { sql, count, min } from "drizzle-orm";
import { emailOutbox, mailboxes } from "./db/schema.js";
import { installAuthGuard } from "./modules/auth/guard.js";
import fs from "node:fs";
import path from "node:path";
import fastify from "fastify";
import cors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import type { AppDatabase } from "./db/index.js";
import { getDb } from "./db/index.js";
import { getEnvConfig } from "./config/env.js";
import { UsersRepository } from "./modules/users/users.repository.js";
import { RolesRepository } from "./modules/roles/roles.repository.js";
import { TicketsRepository } from "./modules/tickets/tickets.repository.js";
import { TicketsService } from "./modules/tickets/tickets.service.js";
import { SmtpService } from "./modules/email/smtp.service.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { StorageService } from "./modules/storage/storage.service.js";
import { registerTicketRoutes } from "./modules/tickets/tickets.routes.js";
import { registerUserRoutes } from "./modules/users/users.routes.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerAdminRoutes } from "./modules/admin/admin.routes.js";
import { MailboxesRepository } from "./modules/mailboxes/mailboxes.repository.js";
import { registerMailboxesRoutes } from "./modules/mailboxes/mailboxes.routes.js";
import type { ImapWorker } from "./modules/email/imap.worker.js";
import { AppError } from "./shared/errors.js";
import { logger } from "./shared/logger.js";

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
    trustProxy: env.TRUSTED_PROXIES
      ? env.TRUSTED_PROXIES.split(",").map((s) => s.trim())
      : false,
    bodyLimit: Math.ceil((env.MAX_MESSAGE_BYTES * 4) / 3) + 65536,
    requestTimeout: 30000,
    logger: options.enableLogging
      ? {
          level: process.env.LOG_LEVEL || "info",
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "password",
            "secret",
          ],
          serializers: {
            req: (req: any) => ({
              method: req.method,
              url: String(req.url).split("?")[0],
              remoteAddress: req.ip,
            }),
          },
        }
      : false,
  });

  app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "blob:", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  app.register(cors, {
    origin: env.CORS_ORIGIN || false,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
  });

  app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
  });

  // Strip Content-Type on body-less requests to avoid FST_ERR_CTP_EMPTY_JSON_BODY
  app.addHook("onRequest", async (req) => {
    if (
      (req.method === "DELETE" || req.method === "GET") &&
      req.headers["content-type"]
    ) {
      delete req.headers["content-type"];
    }
  });

  const db = options.db || getDb();
  const usersRepo = new UsersRepository(db);
  const rolesRepo = new RolesRepository(db);
  const ticketsRepo = new TicketsRepository(db);
  const mailboxesRepo = options.mailboxesRepo || new MailboxesRepository(db);
  const smtpService = options.smtpService || new SmtpService(mailboxesRepo);
  const storageService = options.storageService || new StorageService(db);
  const ticketsService = new TicketsService(
    ticketsRepo,
    smtpService,
    storageService,
  );
  const authService = new AuthService(usersRepo, (payload) =>
    app.jwt.sign(payload, { expiresIn: "12h" }),
  );

  installAuthGuard(app, usersRepo, rolesRepo);
  app.addHook("onSend", async (req, reply) => {
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
  });

  // Static assets delivery for modern SPA
  const publicDirs = [
    path.join(process.cwd(), "backend/src/public"),
    path.join(process.cwd(), "dist/backend/src/public"),
  ];

  const serveStaticFile = async (
    relPath: string,
    reply: any,
    defaultMime?: string,
  ) => {
    if (
      relPath.includes("..") ||
      relPath.includes("\\") ||
      path.isAbsolute(relPath)
    )
      return reply.code(404).send("Not Found");
    for (const dir of publicDirs) {
      const fullPath = path.resolve(dir, relPath);
      const relative = path.relative(path.resolve(dir), fullPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      try {
        const realRoot = await fs.promises.realpath(dir);
        const realFile = await fs.promises.realpath(fullPath);
        const realRelative = path.relative(realRoot, realFile);
        if (realRelative.startsWith("..") || path.isAbsolute(realRelative))
          continue;
        if (!(await fs.promises.stat(realFile)).isFile()) continue;
        const types: Record<string, string> = {
          ".css": "text/css",
          ".js": "application/javascript",
          ".svg": "image/svg+xml",
          ".html": "text/html",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".ico": "image/x-icon",
        };
        reply.header(
          "Cache-Control",
          relPath.endsWith(".html") ? "no-cache" : "public, max-age=300",
        );
        return reply
          .type(
            types[path.extname(realFile)] ||
              defaultMime ||
              "application/octet-stream",
          )
          .send(fs.createReadStream(realFile));
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return reply.code(404).send("Not Found");
  };
  for (const folder of ["css", "js", "assets"])
    app.get("/" + folder + "/:file", async (req, reply) => {
      const { file } = req.params as { file: string };
      if (!/^[a-zA-Z0-9_.-]+$/.test(file))
        return reply.code(404).send("Not Found");
      return serveStaticFile(folder + "/" + file, reply);
    });

  app.get("/aitu_logo.svg", async (_req, reply) => {
    return serveStaticFile("aitu_logo.svg", reply, "image/svg+xml");
  });

  app.get("/favicon.svg", async (_req, reply) => {
    return serveStaticFile("favicon.svg", reply, "image/svg+xml");
  });

  app.get("/favicon.ico", async (_req, reply) => {
    return serveStaticFile("favicon.svg", reply, "image/svg+xml");
  });

  app.get("/apple-touch-icon.png", async (_req, reply) => {
    return serveStaticFile("apple-touch-icon.png", reply, "image/png");
  });

  app.get("/", async (req, reply) => {
    const accept = req.headers.accept || "";
    const isJsonOnly =
      accept.includes("application/json") && !accept.includes("text/html");
    if (!isJsonOnly) {
      return serveStaticFile("index.html", reply);
    }

    return reply.status(200).send({
      name: "Helpdesk API Service",
      version: "1.0.0",
      status: "online",
      endpoints: {
        health: "/health",
        tickets: "/api/tickets",
        users: "/api/users",
        auth: "/api/auth",
        admin: "/api/admin",
      },
    });
  });

  // Healthcheck endpoint
  app.get("/health", async (_req, reply) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: "ok", timestamp: new Date().toISOString() };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  // Register routes
  app.get("/api/admin/operations", async () => {
    const outbox = await db
      .select({
        status: emailOutbox.status,
        total: count(),
        oldestCreatedAt: min(emailOutbox.createdAt),
      })
      .from(emailOutbox)
      .groupBy(emailOutbox.status);
    const inboxes = await db
      .select({
        id: mailboxes.id,
        isActive: mailboxes.isActive,
        lastSyncAt: mailboxes.lastSyncAt,
        lastSyncError: mailboxes.lastSyncError,
      })
      .from(mailboxes);
    const storage = await fs.promises.statfs(storageService.getStorageDir());
    return {
      timestamp: new Date().toISOString(),
      outbox,
      mailboxes: inboxes.map((m) => ({
        ...m,
        stale:
          m.isActive &&
          (!m.lastSyncAt ||
            Date.now() - m.lastSyncAt.getTime() >
              Math.max(300000, env.IMAP_POLL_INTERVAL_MS * 5)),
      })),
      storage: { availableBytes: storage.bavail * storage.bsize },
      process: {
        uptimeSeconds: process.uptime(),
        rssBytes: process.memoryUsage().rss,
      },
    };
  });
  app.register(
    (instance, opts, done) => {
      registerAuthRoutes(instance, authService, usersRepo, opts, done);
    },
    { prefix: "/api/auth" },
  );

  app.register(
    (instance, opts, done) => {
      registerAdminRoutes(instance, usersRepo, rolesRepo, opts, done);
    },
    { prefix: "/api/admin" },
  );

  registerMailboxesRoutes(app, mailboxesRepo, options.imapWorker);

  app.register(
    (instance, opts, done) => {
      registerTicketRoutes(
        instance,
        ticketsService,
        storageService,
        opts,
        done,
      );
    },
    { prefix: "/api/tickets" },
  );

  app.register(
    (instance, opts, done) => {
      registerUserRoutes(instance, usersRepo, opts, done);
    },
    { prefix: "/api/users" },
  );

  // Centralized error handling
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "Validation Error",
        message: "Invalid request payload or query parameters",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const errAny = error as any;
    if (
      error instanceof AppError ||
      (errAny &&
        typeof errAny.statusCode === "number" &&
        errAny.statusCode >= 400 &&
        errAny.statusCode < 500)
    ) {
      return reply.status(errAny.statusCode || 400).send({
        error: errAny.code || "ERROR",
        message: errAny.message || "Request failed",
      });
    }

    if (
      errAny?.statusCode === 401 ||
      (typeof errAny?.code === "string" && errAny.code.startsWith("FST_JWT"))
    ) {
      return reply.status(401).send({
        error: "UNAUTHORIZED",
        message: errAny?.message || "Authentication required",
      });
    }

    if (errAny?.code === "23505" || errAny?.cause?.code === "23505") {
      return reply.status(409).send({
        error: "CONFLICT",
        message: "A record with these unique details already exists",
      });
    }

    if (errAny?.code === "23503" || errAny?.cause?.code === "23503")
      return reply.code(409).send({
        error: "CONFLICT",
        message:
          "This record is still in use, or a referenced record no longer exists",
      });
    // Drizzle errors may contain SQL parameter values, including message bodies.
    logger.error(
      {
        name: errAny?.name,
        code: errAny?.code,
        causeCode: errAny?.cause?.code,
      },
      "Unhandled server error",
    );

    // Never expose raw stack traces or internal secrets to client
    return reply.status(500).send({
      error: "INTERNAL_SERVER_ERROR",
      message: "An unexpected internal error occurred",
    });
  });

  return app;
}
