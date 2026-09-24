import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config({ quiet: true });
const bool = (fallback: boolean) =>
  z.preprocess(
    (v) =>
      v === undefined
        ? fallback
        : v === "true"
          ? true
          : v === "false"
            ? false
            : v,
    z.boolean(),
  );
const port = (fallback: number) =>
  z.coerce.number().int().min(1).max(65535).default(fallback);
const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_PORT: port(3000),
    APP_HOST: z.string().default("127.0.0.1"),
    DATABASE_URL: z
      .string()
      .default("postgresql://postgres:postgres@localhost:5432/helpdesk"),
    MIGRATION_DATABASE_URL: z.string().optional(),
    JWT_SECRET: z.string().default("development-only-not-a-production-secret"),
    SECRET_ENCRYPTION_KEY: z.string().optional(),
    CORS_ORIGIN: z.string().default(""),
    TRUSTED_PROXIES: z.string().default(""),
    STORAGE_DIR: z.string().default(path.join(process.cwd(), "storage")),
    ATTACHMENT_RETENTION_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(87600)
      .default(24),
    CLEANUP_CHECK_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(86400000)
      .default(3600000),
    MAX_ATTACHMENT_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(50 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    MAX_MESSAGE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(100 * 1024 * 1024)
      .default(25 * 1024 * 1024),
    IMAP_HOST: z.string().optional(),
    IMAP_PORT: port(993),
    IMAP_USER: z.string().optional(),
    IMAP_PASSWORD: z.string().optional(),
    IMAP_SECURE: bool(true),
    IMAP_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(86400000)
      .default(30000),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: port(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: bool(false),
    SMTP_FROM: z.string().default("support@example.com"),
  })
  .superRefine((env, ctx) => {
    if (env.MAX_ATTACHMENT_BYTES > env.MAX_MESSAGE_BYTES)
      ctx.addIssue({
        code: "custom",
        path: ["MAX_ATTACHMENT_BYTES"],
        message: "Per-file limit cannot exceed total message limit",
      });
    if (env.NODE_ENV !== "production") return;
    if (
      env.JWT_SECRET.length < 48 ||
      /change.?me|development|helpdesk-secret/i.test(env.JWT_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message:
          "A unique production secret of at least 48 characters is required",
      });
    }
    if (
      !env.SECRET_ENCRYPTION_KEY ||
      !/^[a-f0-9]{64}$/i.test(env.SECRET_ENCRYPTION_KEY)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SECRET_ENCRYPTION_KEY"],
        message: "A 32-byte hex encryption key is required",
      });
    }
    try {
      const origin = new URL(env.CORS_ORIGIN);
      if (
        origin.origin !== env.CORS_ORIGIN ||
        !["http:", "https:"].includes(origin.protocol)
      )
        throw new Error();
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGIN"],
        message: "Set the exact application origin",
      });
    }
  });
export type EnvConfig = z.infer<typeof envSchema>;
export function getEnvConfig(): EnvConfig {
  return envSchema.parse(process.env);
}
