import { newDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './src/db/schema.js';
import { INIT_SCHEMA_SQL } from './src/db/migrate.js';

async function testPgMem() {
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
      if (res.rows.length > 0) {
        console.log('Fields:', res.fields, 'First row:', res.rows[0]);
      }
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

  // Test insert user
  const returned = await db.insert(schema.users).values({
    name: 'Vasily',
    email: 'vasily@example.com',
  }).returning();

  console.log('Inserted raw:', returned);

  // Test query with count
  const res = await pool.query(`
    SELECT u.id, COUNT(t.id) as count
    FROM users u
    LEFT JOIN tickets t ON t.assignee_id = u.id AND t.status != 'RESOLVED'
    WHERE u.is_active = true
    GROUP BY u.id
    ORDER BY count ASC
    LIMIT 1
  `);
  console.log('Query result:', res.rows);
  await pool.end();
}

testPgMem().catch(console.error);
