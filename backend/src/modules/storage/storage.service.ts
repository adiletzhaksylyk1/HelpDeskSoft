import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../../db/index.js";
import { ticketAttachments, type TicketAttachment } from "../../db/schema.js";
import { getEnvConfig } from "../../config/env.js";
import { ValidationError } from "../../shared/errors.js";
export class StorageService {
  private storageDir: string;
  constructor(
    readonly db: AppDatabase,
    customStorageDir?: string,
  ) {
    this.storageDir = path.resolve(
      customStorageDir || getEnvConfig().STORAGE_DIR,
    );
    fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
    this.storageDir = fs.realpathSync(this.storageDir);
    fs.accessSync(this.storageDir, fs.constants.R_OK | fs.constants.W_OK);
  }
  withDb(db: AppDatabase): StorageService {
    return new StorageService(db, this.storageDir);
  }
  getStorageDir(): string {
    return this.storageDir;
  }
  async checkedPath(file: string): Promise<string> {
    const absolute = path.resolve(file);
    const relative = path.relative(this.storageDir, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new ValidationError("Invalid storage path");
    // Check every existing ancestor, including symlinks, before reading/writing/removing.
    let current = absolute;
    while (current !== this.storageDir) {
      try {
        const real = await fs.promises.realpath(current);
        const rel = path.relative(this.storageDir, real);
        if (rel.startsWith("..") || path.isAbsolute(rel))
          throw new ValidationError("Storage symlink escapes root");
      } catch (err: any) {
        if (err.code !== "ENOENT") throw err;
      }
      current = path.dirname(current);
    }
    return absolute;
  }
  async saveAttachment(input: {
    ticketId: string;
    replyId?: string;
    ingestKey?: string;
    originalName: string;
    mimeType: string;
    content: Buffer;
  }): Promise<TicketAttachment> {
    return this.saveStream({ ...input, stream: Readable.from(input.content) });
  }
  async saveStream(input: {
    ticketId: string;
    replyId?: string;
    ingestKey?: string;
    originalName: string;
    mimeType: string;
    stream: Readable;
  }): Promise<TicketAttachment> {
    z.string().uuid().parse(input.ticketId);
    if (input.originalName.length > 255)
      throw new ValidationError("Filename too long");
    if (input.ingestKey) {
      const [existing] = await this.db
        .select()
        .from(ticketAttachments)
        .where(eq(ticketAttachments.ingestKey, input.ingestKey));
      if (existing) {
        input.stream.resume();
        return existing;
      }
    }
    const folder = await this.checkedPath(
      path.join(this.storageDir, "tickets", input.ticketId),
    );
    await fs.promises.mkdir(folder, { recursive: true, mode: 0o700 });
    const filename = crypto.randomUUID() + ".bin";
    const absolute = await this.checkedPath(path.join(folder, filename));
    let size = 0;
    const max = getEnvConfig().MAX_ATTACHMENT_BYTES;
    const limiter = new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        done(
          size > max
            ? new ValidationError("Attachment exceeds maximum size")
            : null,
          chunk,
        );
      },
    });
    try {
      await pipeline(
        input.stream,
        limiter,
        fs.createWriteStream(absolute, { flags: "wx", mode: 0o600 }),
      );
      const [record] = await this.db
        .insert(ticketAttachments)
        .values({
          ticketId: input.ticketId,
          replyId: input.replyId,
          ingestKey: input.ingestKey,
          filename,
          originalName: input.originalName,
          mimeType: input.mimeType || "application/octet-stream",
          size,
          storagePath: absolute,
          isPurged: false,
        })
        .returning();
      return record;
    } catch (error) {
      await fs.promises.unlink(absolute).catch(() => {});
      throw error;
    }
  }
  async findByTicketId(ticketId: string): Promise<TicketAttachment[]> {
    return this.db
      .select()
      .from(ticketAttachments)
      .where(eq(ticketAttachments.ticketId, ticketId))
      .orderBy(ticketAttachments.createdAt);
  }
  async findById(id: string): Promise<TicketAttachment | null> {
    const [a] = await this.db
      .select()
      .from(ticketAttachments)
      .where(eq(ticketAttachments.id, id));
    return a || null;
  }
  async markAsPurged(id: string): Promise<TicketAttachment | null> {
    const [a] = await this.db
      .update(ticketAttachments)
      .set({ isPurged: true, purgedAt: new Date() })
      .where(eq(ticketAttachments.id, id))
      .returning();
    return a || null;
  }
  async deletePhysicalFile(
    file: string,
  ): Promise<"deleted" | "missing" | "failed"> {
    try {
      await fs.promises.unlink(await this.checkedPath(file));
      return "deleted";
    } catch (error: any) {
      return error.code === "ENOENT" ? "missing" : "failed";
    }
  }
  async deleteTicketStorage(ticketId: string): Promise<boolean> {
    z.string().uuid().parse(ticketId);
    const target = await this.checkedPath(
      path.join(this.storageDir, "tickets", ticketId),
    );
    await fs.promises.rm(target, { recursive: true, force: true });
    return true;
  }
  async reconcileOrphans(): Promise<number> {
    const root = path.join(this.storageDir, "tickets");
    let removed = 0;
    const folders = await fs.promises
      .readdir(root, { withFileTypes: true })
      .catch(() => []);
    for (const folder of folders) {
      if (
        !folder.isDirectory() ||
        !z.string().uuid().safeParse(folder.name).success
      )
        continue;
      const dir = await this.checkedPath(path.join(root, folder.name));
      const records = await this.findByTicketId(folder.name);
      const known = new Set(records.map((r) => path.resolve(r.storagePath)));
      for (const file of await fs.promises.readdir(dir, {
        withFileTypes: true,
      })) {
        if (!file.isFile()) continue;
        const target = await this.checkedPath(path.join(dir, file.name));
        if (
          !known.has(target) &&
          (await fs.promises.stat(target)).mtimeMs < Date.now() - 86400000 &&
          (await this.deletePhysicalFile(target)) === "deleted"
        )
          removed++;
      }
    }
    return removed;
  }
}
