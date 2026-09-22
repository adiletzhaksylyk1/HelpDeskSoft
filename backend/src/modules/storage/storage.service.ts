import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { ticketAttachments, type TicketAttachment, type NewTicketAttachment } from '../../db/schema.js';
import { getEnvConfig } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

export class StorageService {
  private storageDir: string;

  constructor(
    private readonly db: AppDatabase,
    customStorageDir?: string
  ) {
    const env = getEnvConfig();
    this.storageDir = customStorageDir || env.STORAGE_DIR || path.join(process.cwd(), 'storage');
    this.ensureDirectoryExists(this.storageDir);
  }

  private ensureDirectoryExists(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.info({ dirPath }, 'Storage directory initialized');
      }
    } catch (err) {
      logger.warn({ err, dirPath }, 'Failed to create storage directory on primary path, falling back to local storage');
      this.storageDir = path.join(process.cwd(), 'storage');
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    }
  }

  getStorageDir(): string {
    return this.storageDir;
  }

  async saveAttachment(input: {
    ticketId: string;
    originalName: string;
    mimeType: string;
    content: Buffer;
  }): Promise<TicketAttachment> {
    const ticketFolder = path.join(this.storageDir, 'tickets', input.ticketId);
    if (!fs.existsSync(ticketFolder)) {
      fs.mkdirSync(ticketFolder, { recursive: true });
    }

    const ext = path.extname(input.originalName) || '';
    const safeBase = path.basename(input.originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const storedFilename = `${crypto.randomUUID()}-${safeBase}${ext}`;
    const absolutePath = path.join(ticketFolder, storedFilename);

    await fs.promises.writeFile(absolutePath, input.content);

    const [record] = await this.db
      .insert(ticketAttachments)
      .values({
        ticketId: input.ticketId,
        filename: storedFilename,
        originalName: input.originalName,
        mimeType: input.mimeType || 'application/octet-stream',
        size: input.content.length,
        storagePath: absolutePath,
        isPurged: false,
      })
      .returning();

    logger.info(
      { attachmentId: record.id, ticketId: input.ticketId, filename: input.originalName, size: record.size },
      'Attachment stored successfully'
    );

    return record;
  }

  async findByTicketId(ticketId: string): Promise<TicketAttachment[]> {
    return this.db
      .select()
      .from(ticketAttachments)
      .where(eq(ticketAttachments.ticketId, ticketId))
      .orderBy(ticketAttachments.createdAt);
  }

  async findById(attachmentId: string): Promise<TicketAttachment | null> {
    const [attachment] = await this.db
      .select()
      .from(ticketAttachments)
      .where(eq(ticketAttachments.id, attachmentId))
      .limit(1);

    return attachment || null;
  }

  async markAsPurged(attachmentId: string): Promise<TicketAttachment | null> {
    const [updated] = await this.db
      .update(ticketAttachments)
      .set({
        isPurged: true,
        purgedAt: new Date(),
      })
      .where(eq(ticketAttachments.id, attachmentId))
      .returning();
    return updated || null;
  }

  async deletePhysicalFile(filePath: string): Promise<boolean> {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
      return false;
    } catch (err) {
      logger.error({ err, filePath }, 'Error deleting physical file from storage');
      return false;
    }
  }

  async deleteTicketStorage(ticketId: string): Promise<boolean> {
    try {
      const ticketDir = path.join(this.storageDir, 'tickets', ticketId);
      if (fs.existsSync(ticketDir)) {
        await fs.promises.rm(ticketDir, { recursive: true, force: true });
        return true;
      }
      return false;
    } catch (err) {
      logger.error({ err, ticketId }, 'Error deleting ticket storage directory');
      return false;
    }
  }
}

