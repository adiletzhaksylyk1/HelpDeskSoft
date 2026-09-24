import "./setup.js";
import { createTestDb } from "./test-db.js";
import { buildApp } from "../backend/src/app.js";
import { testSession } from "./helpers.js";
import { tickets } from "../backend/src/db/schema.js";
import { eq } from "drizzle-orm";
import { StorageService } from "../backend/src/modules/storage/storage.service.js";
const db = await createTestDb();
const storage = new StorageService(db.db);
const app = buildApp({ db: db.db, storageService: storage });
const { user } = await testSession(app, db, "admin");
await db.pool.query("UPDATE users SET email=$1 WHERE id=$2", [
  "browser@example.com",
  user.id,
]);
for (let i = 0; i < 105; i++)
  await db.db
    .insert(tickets)
    .values({
      messageId: `<browser-${i}@test>`,
      senderEmail: "customer@example.com",
      subject: i === 0 ? "Oldest searchable request" : "Browser ticket " + i,
      body: "Customer needs assistance",
      status: "WAITING",
      priority: "MEDIUM",
      createdAt: new Date(1700000000000 + i * 1000),
    });
const [first] = await db.db
  .select()
  .from(tickets)
  .where(eq(tickets.subject, "Oldest searchable request"));
await storage.saveAttachment({
  ticketId: first.id,
  originalName: "&#39;);window.__xss=1;//.txt",
  mimeType: "text/plain",
  content: Buffer.from("safe fixture"),
});
await app.listen({ host: "127.0.0.1", port: 3101 });
async function close() {
  await app.close();
  await db.cleanup();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
