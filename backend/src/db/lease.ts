import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { AppDatabase } from "./index.js";
import { withDbLock } from "./lock.js";
export async function withLease<T>(
  db: AppDatabase,
  name: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  const owner = crypto.randomUUID();
  const acquired = await withDbLock(db, 740012, async (tx) => {
    await tx.execute(
      sql`DELETE FROM worker_leases WHERE name=${name} AND expires_at<${new Date()}`,
    );
    const current = await tx.execute(
      sql`SELECT name FROM worker_leases WHERE name=${name}`,
    );
    if (current.rows.length) return false;
    await tx.execute(
      sql`INSERT INTO worker_leases(name,owner,expires_at) VALUES (${name},${owner},${new Date(Date.now() + 300000)})`,
    );
    return true;
  });
  if (!acquired) return undefined;
  let leaseLost = false;
  const renewal = setInterval(
    () =>
      void db
        .execute(
          sql`UPDATE worker_leases SET expires_at=${new Date(Date.now() + 300000)} WHERE name=${name} AND owner=${owner}`,
        )
        .catch(() => {
          leaseLost = true;
        }),
    60000,
  );
  try {
    const result = await work();
    if (leaseLost) throw new Error("Worker lease renewal failed");
    return result;
  } finally {
    clearInterval(renewal);
    await db.execute(
      sql`DELETE FROM worker_leases WHERE name=${name} AND owner=${owner}`,
    );
  }
}
