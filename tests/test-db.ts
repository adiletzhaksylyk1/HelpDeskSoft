import { HARDENING_SQL } from "../backend/src/db/hardening.js";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import crypto from "node:crypto";
import * as schema from "../backend/src/db/schema.js";
import { INIT_SCHEMA_SQL } from "../backend/src/db/migrate.js";
import type { AppDatabase } from "../backend/src/db/index.js";

export interface TestDbInstance {
  db: AppDatabase;
  pool: any;
  cleanup: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDbInstance> {
  const mem = newDb();
  mem.public.registerFunction({
    name: "left",
    args: [DataType.text, DataType.integer],
    returns: DataType.text,
    implementation: (value: string, length: number) => value.slice(0, length),
  });

  mem.public.registerFunction({
    name: "gen_random_uuid",
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  mem.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
    impure: true,
  });
  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();
  const origQuery = pool.query.bind(pool);

  pool.query = async (q: any, ...args: any[]) => {
    const isArrayMode = q && typeof q === "object" && q.rowMode === "array";
    if (q && typeof q === "object") {
      delete q.types;
      delete q.rowMode;
    }
    const res = await origQuery(q, ...args);
    if (isArrayMode && res && Array.isArray(res.rows)) {
      if (res.fields && res.fields.length > 0) {
        res.rows = res.rows.map((row: any) =>
          res.fields.map((f: any) => row[f.name]),
        );
      } else {
        res.rows = res.rows.map((row: any) => Object.values(row));
      }
    }
    return res;
  };

  await pool.query(INIT_SCHEMA_SQL);
  await pool.query(HARDENING_SQL);
  await pool.query(
    "INSERT INTO roles(name) VALUES ('employee'), ('MyDU support') ON CONFLICT(name) DO NOTHING",
  );
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    cleanup: async () => {
      await pool.end();
    },
  };
}
