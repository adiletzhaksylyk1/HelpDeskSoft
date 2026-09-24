import { beforeAll, afterAll, describe, it, expect } from "vitest";
import pg from "pg";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runMigrations, INIT_SCHEMA_SQL } from "../backend/src/db/migrate.js";
import { createDb } from "../backend/src/db/index.js";
import { UsersRepository } from "../backend/src/modules/users/users.repository.js";
import { TicketsRepository } from "../backend/src/modules/tickets/tickets.repository.js";
import { TicketsService } from "../backend/src/modules/tickets/tickets.service.js";
import { StorageService } from "../backend/src/modules/storage/storage.service.js";
import { ticketReplies, emailOutbox } from "../backend/src/db/schema.js";
// Only an explicitly supplied disposable database is touched; never DATABASE_URL.
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "PostgreSQL migrations, locking, and rollback",
  () => {
    let admin: pg.Pool, pool: pg.Pool;
    const schema = "test_" + crypto.randomUUID().replaceAll("-", "");
    beforeAll(async () => {
      admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
      await admin.query("CREATE SCHEMA " + schema);
      pool = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: "-c search_path=" + schema,
        max: 16,
      });
      await Promise.all([runMigrations(pool), runMigrations(pool)]);
    }, 30000);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        await admin.end();
      }
    });
    it("installs once, does not seed an admin, and enforces invariants", async () => {
      expect(
        (
          await pool.query(
            "SELECT version FROM schema_migrations ORDER BY version",
          )
        ).rows.map((r) => r.version),
      ).toEqual([1, 2, 3]);
      expect((await pool.query("SELECT * FROM users")).rowCount).toBe(0);
      await expect(
        pool.query(
          "INSERT INTO users(name,email,role) VALUES('bad','bad@test','unknown')",
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        pool.query(
          "INSERT INTO tickets(message_id,sender_email,subject,body,status) VALUES('bad','bad@test','bad','bad','BAD')",
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
    it("repairs an already-migrated version 2 without losing ticket content or replies", async () => {
      const upgradeSchema = schema + "_upgrade";
      await admin.query("CREATE SCHEMA " + upgradeSchema);
      const previous = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: "-c search_path=" + upgradeSchema,
      });
      try {
        await runMigrations(previous);
        await previous.query(
          "ALTER TABLE ticket_replies DROP COLUMN request_hash",
        );
        await previous.query("DELETE FROM schema_migrations WHERE version=3");
        const {
          rows: [ticket],
        } = await previous.query(
          "INSERT INTO tickets(message_id,sender_email,subject,body) VALUES('upgrade@test','client@test','Existing ticket','Original content') RETURNING id",
        );
        await previous.query(
          "INSERT INTO ticket_replies(ticket_id,body,sender_type) VALUES($1,'Existing reply','CUSTOMER')",
          [ticket.id],
        );
        const repo = new TicketsRepository(createDb(previous));
        await expect(repo.findById(ticket.id)).rejects.toMatchObject({
          cause: { code: "42703" },
        });
        await runMigrations(previous);
        await runMigrations(previous);
        const restored = await repo.findById(ticket.id);
        expect(restored?.body).toBe("Original content");
        expect(restored?.replyCount).toBe(1);
        expect(restored?.replies?.[0].body).toBe("Existing reply");
        expect(restored?.replies?.[0].requestHash).toBeNull();
      } finally {
        await previous.end();
        await admin.query("DROP SCHEMA " + upgradeSchema + " CASCADE");
      }
    });
    it("balances twelve concurrent assignments across independent database handles", async () => {
      const db = createDb(pool),
        users = new UsersRepository(db);
      const one = await users.create({ name: "One", email: "one@test" }),
        two = await users.create({ name: "Two", email: "two@test" });
      const created = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          new TicketsService(
            new TicketsRepository(createDb(pool)),
          ).createTicket({
            senderEmail: "client@test",
            subject: "parallel " + i,
            body: "body",
          }),
        ),
      );
      expect(created.filter((t) => t.assigneeId === one.id)).toHaveLength(6);
      expect(created.filter((t) => t.assigneeId === two.id)).toHaveLength(6);
    });
    it("rolls back reply and outbox when attachment persistence fails", async () => {
      const db = createDb(pool),
        repo = new TicketsRepository(db),
        storage = new StorageService(db);
      const ticket = await repo.create({
        senderEmail: "client@test",
        subject: "rollback",
        body: "body",
      });
      storage.withDb = () =>
        ({
          saveAttachment: async () => {
            throw new Error("disk failed");
          },
        }) as unknown as StorageService;
      await expect(
        new TicketsService(repo, undefined, storage).addReply(ticket.id, {
          body: "reply",
          senderType: "EMPLOYEE",
          attachments: [{ originalName: "file", content: Buffer.from("data") }],
        }),
      ).rejects.toThrow("disk failed");
      expect(await db.select().from(ticketReplies)).toHaveLength(0);
      expect(await db.select().from(emailOutbox)).toHaveLength(0);
    });
    it("preserves an initialized administrator during concurrent reset and disable operations", async () => {
      const first = new UsersRepository(createDb(pool)),
        second = new UsersRepository(createDb(pool));
      const a = await first.create({
          name: "Admin A",
          email: "admin-a@test",
          role: "admin",
          passwordHash: "initialized",
        }),
        b = await first.create({
          name: "Admin B",
          email: "admin-b@test",
          role: "admin",
          passwordHash: "initialized",
        });
      const results = await Promise.allSettled([
        first.safeUpdate(a.id, { isActive: false }),
        second.resetInvitation(b.id),
      ]);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM users WHERE role='admin' AND is_active AND password_hash IS NOT NULL",
            )
          ).rows[0].count,
        ),
      ).toBe(1);
    });
    it.skipIf(process.env.PG_TEST_SKIP_BACKUP === "1")(
      "restores a PostgreSQL custom-format backup with its original records",
      async () => {
        const binary = (name: string) =>
          process.env.PG_TEST_BIN
            ? path.join(
                process.env.PG_TEST_BIN,
                name + (process.platform === "win32" ? ".exe" : ""),
              )
            : name;
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hd-backup-")),
          dump = path.join(directory, "database.dump"),
          target = schema + "_restore";
        const originalUrl = new URL(process.env.TEST_DATABASE_URL!);
        const env = {
          ...process.env,
          PGHOST: originalUrl.hostname,
          PGPORT: originalUrl.port,
          PGUSER: decodeURIComponent(originalUrl.username),
          PGPASSWORD: decodeURIComponent(originalUrl.password),
        };
        await admin.query("CREATE DATABASE " + target);
        try {
          await promisify(execFile)(
            binary("pg_dump"),
            [
              "-d",
              originalUrl.pathname.slice(1),
              "-n",
              schema,
              "-Fc",
              "-f",
              dump,
            ],
            { env },
          );
          await promisify(execFile)(
            binary("pg_restore"),
            ["-d", target, "--exit-on-error", dump],
            { env },
          );
          const restoredUrl = new URL(originalUrl);
          restoredUrl.pathname = "/" + target;
          const restored = new pg.Pool({
            connectionString: restoredUrl.toString(),
          });
          try {
            expect(
              (
                await restored.query(
                  "SELECT count(*) FROM " + schema + ".tickets",
                )
              ).rows[0].count,
            ).toBe(
              (await pool.query("SELECT count(*) FROM tickets")).rows[0].count,
            );
          } finally {
            await restored.end();
          }
        } finally {
          await admin.query("DROP DATABASE " + target);
          fs.rmSync(directory, { recursive: true, force: true });
        }
      },
    );
    it("upgrades a legacy schema and encrypts credentials without losing records", async () => {
      const legacy = schema + "_upgrade";
      await admin.query("CREATE SCHEMA " + legacy);
      const old = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: "-c search_path=" + legacy,
      });
      try {
        await old.query(INIT_SCHEMA_SQL);
        await old.query(
          "INSERT INTO users(name,email,role,password_hash) VALUES('Legacy','legacy@test','Legacy Department','existing')",
        );
        await old.query(
          "INSERT INTO mailboxes(name,email,imap_host,imap_user,imap_password,smtp_host,smtp_user,smtp_password) VALUES('Legacy','mail@test','imap.test','mail',' secret ','smtp.test','mail',' secret ')",
        );
        await runMigrations(old);
        await runMigrations(old);
        expect(
          (await old.query("SELECT password_hash FROM users")).rows[0]
            .password_hash,
        ).toBe("existing");
        expect(
          (await old.query("SELECT imap_password FROM mailboxes")).rows[0]
            .imap_password,
        ).toMatch(/^enc:v1:/);
        expect(
          (
            await old.query(
              "SELECT name FROM roles WHERE name='Legacy Department'",
            )
          ).rowCount,
        ).toBe(1);
      } finally {
        await old.end();
        await admin.query("DROP SCHEMA " + legacy + " CASCADE");
      }
    });
  },
);
