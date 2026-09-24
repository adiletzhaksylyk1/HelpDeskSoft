import { sql } from "drizzle-orm";
import type { AppDatabase } from "./index.js";
const queues = new WeakMap<object, Promise<unknown>>();
// The advisory transaction lock coordinates processes; the local queue also
// allows deterministic concurrency tests with the in-memory SQL adapter.
export async function withDbLock<T>(
  db: AppDatabase,
  key: number,
  work: (tx: AppDatabase) => Promise<T>,
): Promise<T> {
  const previous = queues.get(db) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${key})`);
        return work(tx as unknown as AppDatabase);
      }),
    );
  queues.set(
    db,
    next.catch(() => {}),
  );
  return next;
}
