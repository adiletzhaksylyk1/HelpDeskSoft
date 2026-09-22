import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './backend/src/db/schema.ts',
  out: './backend/src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5433/helpdesk',
  },
});
