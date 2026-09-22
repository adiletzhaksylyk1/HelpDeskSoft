import { eq, and, lte, sql, inArray } from 'drizzle-orm';
import type { AppDatabase } from '../../db/index.js';
import { tickets, ticketAttachments, type TicketAttachment } from '../../db/schema.js';
import type { StorageService } from '../storage/storage.service.js';
import { getEnvConfig } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

export interface PurgeResult {
  purgedCount: number;
  bytesFreed: number;
}

export class CleanupWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly storageService: StorageService,
    private readonly retentionHoursOverride?: number
  ) { }

  async purgeExpiredAttachments(): Promise<PurgeResult> {
    if (this.isRunning) {
      logger.debug('Cleanup execution already in progress, skipping run');
      return { purgedCount: 0, bytesFreed: 0 };
    }

    this.isRunning = true;
    const env = getEnvConfig();
    const retentionHours = this.retentionHoursOverride ?? env.ATTACHMENT_RETENTION_HOURS ?? 24;
    const cutoffDate = new Date(Date.now() - retentionHours * 60 * 60 * 1000);

    let purgedCount = 0;
    let bytesFreed = 0;

    try {
      // Find attachments for tickets resolved before cutoffDate that have not yet been purged
      const expiredItems = await this.db
        .select({
          attachment: ticketAttachments,
          ticketStatus: tickets.status,
          ticketResolvedAt: tickets.updatedAt,
        })
        .from(ticketAttachments)
        .innerJoin(tickets, eq(ticketAttachments.ticketId, tickets.id))
        .where(
          and(
            eq(tickets.status, 'RESOLVED'),
            lte(tickets.updatedAt, cutoffDate),
            eq(ticketAttachments.isPurged, false)
          )
        );

      if (expiredItems.length === 0) {
        logger.debug({ cutoffDate, retentionHours }, 'No expired attachments eligible for purge');
        return { purgedCount: 0, bytesFreed: 0 };
      }

      logger.info(
        { count: expiredItems.length, retentionHours, cutoffDate },
        'Found expired attachments for resolved tickets. Initiating storage purge'
      );

      for (const { attachment } of expiredItems) {
        // 1. Delete physical file from storage (disk D: or university storage)
        await this.storageService.deletePhysicalFile(attachment.storagePath);

        // 2. Mark attachment as purged in database to preserve audit logs
        await this.db
          .update(ticketAttachments)
          .set({
            isPurged: true,
            purgedAt: new Date(),
          })
          .where(eq(ticketAttachments.id, attachment.id));

        purgedCount++;
        bytesFreed += attachment.size || 0;

        logger.info(
          { attachmentId: attachment.id, filename: attachment.filename, ticketId: attachment.ticketId },
          `Physical file purged per ${retentionHours}h retention policy`
        );
      }

      logger.info({ purgedCount, bytesFreed }, 'Retention cleanup completed successfully');
    } catch (err) {
      logger.error({ err }, 'Error executing retention cleanup worker');
    } finally {
      this.isRunning = false;
    }

    return { purgedCount, bytesFreed };
  }

  start(): void {
    const env = getEnvConfig();
    const intervalMs = env.CLEANUP_CHECK_INTERVAL_MS || 3600000;
    const retentionHours = this.retentionHoursOverride ?? env.ATTACHMENT_RETENTION_HOURS ?? 168;

    logger.info(
      { intervalMs, retentionHours },
      `Starting automated retention cleanup worker (${retentionHours}h retention)`
    );

    // Initial check on boot
    this.purgeExpiredAttachments().catch((err) =>
      logger.error({ err }, 'Initial retention cleanup run failed')
    );

    // Periodic schedule
    this.timer = setInterval(() => {
      this.purgeExpiredAttachments().catch((err) =>
        logger.error({ err }, 'Periodic retention cleanup run failed')
      );
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Automated retention cleanup worker stopped');
    }
  }
}
