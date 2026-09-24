import { eq, and, lte, isNull, like } from "drizzle-orm";
import type { AppDatabase } from "../../db/index.js";
import { tickets, ticketAttachments } from "../../db/schema.js";
import type { StorageService } from "../storage/storage.service.js";
import { getEnvConfig } from "../../config/env.js";
import { withDbLock } from "../../db/lock.js";
import { logger } from "../../shared/logger.js";
export interface PurgeResult {
  purgedCount: number;
  bytesFreed: number;
}
export class CleanupWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<PurgeResult> | null = null;
  constructor(
    private db: AppDatabase,
    private storage: StorageService,
    private retentionHoursOverride?: number,
  ) {}
  async purgeExpiredAttachments(): Promise<PurgeResult> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async run(): Promise<PurgeResult> {
    const cutoff = new Date(
      Date.now() -
        (this.retentionHoursOverride ??
          getEnvConfig().ATTACHMENT_RETENTION_HOURS) *
          3600000,
    );
    const result = await withDbLock(this.db, 740010, async (tx) => {
      const expired = await tx
        .select({ attachment: ticketAttachments })
        .from(ticketAttachments)
        .innerJoin(tickets, eq(ticketAttachments.ticketId, tickets.id))
        .where(
          and(
            eq(tickets.status, "RESOLVED"),
            lte(tickets.resolvedAt, cutoff),
            eq(ticketAttachments.isPurged, false),
          ),
        )
        .limit(100);
      const uploads = await tx
        .select()
        .from(ticketAttachments)
        .where(
          and(
            isNull(ticketAttachments.replyId),
            like(ticketAttachments.ingestKey, "upload:%"),
            lte(ticketAttachments.createdAt, new Date(Date.now() - 86400000)),
            eq(ticketAttachments.isPurged, false),
          ),
        )
        .limit(100);
      let purgedCount = 0,
        bytesFreed = 0;
      for (const attachment of [
        ...expired.map((r) => r.attachment),
        ...uploads,
      ]) {
        const result = await this.storage.deletePhysicalFile(
          attachment.storagePath,
        );
        if (result !== "deleted" && result !== "missing") {
          logger.error(
            { attachmentId: attachment.id },
            "Attachment deletion failed; will retry",
          );
          continue;
        }
        await tx
          .update(ticketAttachments)
          .set({ isPurged: true, purgedAt: new Date() })
          .where(eq(ticketAttachments.id, attachment.id));
        purgedCount++;
        if (result === "deleted") bytesFreed += attachment.size;
      }
      return { purgedCount, bytesFreed };
    });
    await this.storage.reconcileOrphans();
    return result;
  }
  start(): void {
    void this.purgeExpiredAttachments().catch((err) =>
      logger.error({ err }, "Cleanup failed"),
    );
    this.timer = setInterval(
      () =>
        void this.purgeExpiredAttachments().catch((err) =>
          logger.error({ err }, "Cleanup failed"),
        ),
      getEnvConfig().CLEANUP_CHECK_INTERVAL_MS,
    );
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
