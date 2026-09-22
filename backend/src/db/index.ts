import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { getEnvConfig } from '../config/env.js';
import { logger } from '../shared/logger.js';

const { Pool } = pg;

export type AppDatabase = NodePgDatabase<typeof schema>;

let defaultPool: pg.Pool | null = null;
let defaultDb: AppDatabase | null = null;

export function createDb(poolOrClient: pg.Pool | pg.Client): AppDatabase {
  return drizzle(poolOrClient, { schema });
}

export function getDb(): AppDatabase {
  if (defaultDb) {
    return defaultDb;
  }

  const env = getEnvConfig();
  defaultPool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
  });

  defaultPool.on('error', (err) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error');
  });

  defaultDb = drizzle(defaultPool, { schema });
  return defaultDb;
}

export async function closeDb(): Promise<void> {
  if (defaultPool) {
    await defaultPool.end();
    defaultPool = null;
    defaultDb = null;
  }
}
