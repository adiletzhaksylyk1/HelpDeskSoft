import { newDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import crypto from 'node:crypto';
import * as schema from '../backend/src/db/schema.js';
import { INIT_SCHEMA_SQL } from '../backend/src/db/migrate.js';
import type { AppDatabase } from '../backend/src/db/index.js';

export interface TestDbInstance {
  db: AppDatabase;
  pool: any;
  cleanup: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDbInstance> {
  const mem = newDb();

  mem.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => crypto.randomUUID(),
  });

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();
  const origQuery = pool.query.bind(pool);

  pool.query = async (q: any, ...args: any[]) => {
    const isArrayMode = q && typeof q === 'object' && q.rowMode === 'array';
    if (q && typeof q === 'object') {
      delete q.types;
      delete q.rowMode;
    }
    const res = await origQuery(q, ...args);
    if (isArrayMode && res && Array.isArray(res.rows)) {
      if (res.fields && res.fields.length > 0) {
        res.rows = res.rows.map((row: any) => res.fields.map((f: any) => row[f.name]));
      } else {
        res.rows = res.rows.map((row: any) => Object.values(row));
      }
    }
    return res;
  };

  await pool.query(INIT_SCHEMA_SQL);
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    cleanup: async () => {
      await pool.end();
    },
  };
}
