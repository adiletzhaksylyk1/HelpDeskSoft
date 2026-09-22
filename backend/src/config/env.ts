import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PORT: z.coerce.number().default(3000),
  APP_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/helpdesk'),
  JWT_SECRET: z.string().default('helpdesk-secret-key-change-in-production'),
  CORS_ORIGIN: z.string().default('*'),
  STORAGE_DIR: z.string().default(process.env.STORAGE_DIR || path.join(process.cwd(), 'storage')),
  ATTACHMENT_RETENTION_HOURS: z.coerce.number().default(24),
  CLEANUP_CHECK_INTERVAL_MS: z.coerce.number().default(3600000),

  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_USER: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),
  IMAP_SECURE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  IMAP_POLL_INTERVAL_MS: z.coerce.number().default(30000),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  SMTP_FROM: z.string().default('support@example.com'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function getEnvConfig(): EnvConfig {
  return envSchema.parse(process.env);
}
