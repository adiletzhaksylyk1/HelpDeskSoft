import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTestDb, TestDbInstance } from './test-db.js';
import { StorageService } from '../backend/src/modules/storage/storage.service.js';
import { CleanupWorker } from '../backend/src/modules/cleanup/cleanup.worker.js';
import { TicketsRepository } from '../backend/src/modules/tickets/tickets.repository.js';
import { buildApp } from '../backend/src/app.js';
import { tickets } from '../backend/src/db/schema.js';
import { eq } from 'drizzle-orm';

describe('Attachment Storage & 24h Retention Cleanup', () => {
  let testDb: TestDbInstance;
  let ticketsRepo: TicketsRepository;
  let tempStorageDir: string;
  let storageService: StorageService;
  let cleanupWorker: CleanupWorker;

  beforeEach(async () => {
    testDb = await createTestDb();
    ticketsRepo = new TicketsRepository(testDb.db);
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpdesk-storage-test-'));
    storageService = new StorageService(testDb.db, tempStorageDir);
    // Use 24-hour default retention
    cleanupWorker = new CleanupWorker(testDb.db, storageService, 24);
  });

  afterEach(async () => {
    cleanupWorker.stop();
    await testDb.cleanup();
    if (fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
  });

  it('saves attachment to disk storage and records database entry', async () => {
    const ticket = await ticketsRepo.create({
      senderEmail: 'student@uni.edu',
      subject: 'Lab report submission issue',
      body: 'See attached screenshot of error',
    });

    const fileBuffer = Buffer.from('Fake PNG binary content 123456');
    const attachment = await storageService.saveAttachment({
      ticketId: ticket.id,
      originalName: 'error-screen.png',
      mimeType: 'image/png',
      content: fileBuffer,
    });

    expect(attachment.id).toBeDefined();
    expect(attachment.ticketId).toBe(ticket.id);
    expect(attachment.originalName).toBe('error-screen.png');
    expect(attachment.size).toBe(fileBuffer.length);
    expect(attachment.isPurged).toBe(false);
    expect(fs.existsSync(attachment.storagePath)).toBe(true);

    const savedContent = fs.readFileSync(attachment.storagePath);
    expect(savedContent.equals(fileBuffer)).toBe(true);
  });

  it('purges files only for tickets resolved > 24 hours ago, preserving active tickets', async () => {
    // 1. Resolved ticket older than 24 hours (e.g. 26 hours ago)
    const oldResolvedTicket = await ticketsRepo.create({
      senderEmail: 'old@uni.edu',
      subject: 'Old resolved request',
      body: 'Finished yesterday',
      status: 'RESOLVED',
    });
    const twentySixHoursAgo = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await testDb.db
      .update(tickets)
      .set({ updatedAt: twentySixHoursAgo, status: 'RESOLVED' })
      .where(eq(tickets.id, oldResolvedTicket.id));

    const oldAttachment = await storageService.saveAttachment({
      ticketId: oldResolvedTicket.id,
      originalName: 'old-contract.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('PDF file bytes for old ticket'),
    });

    // 2. Resolved ticket resolved recently (e.g. 2 hours ago) -> should NOT be purged
    const freshResolvedTicket = await ticketsRepo.create({
      senderEmail: 'fresh@uni.edu',
      subject: 'Just resolved',
      body: 'Finished recently',
      status: 'RESOLVED',
    });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await testDb.db
      .update(tickets)
      .set({ updatedAt: twoHoursAgo, status: 'RESOLVED' })
      .where(eq(tickets.id, freshResolvedTicket.id));

    const freshAttachment = await storageService.saveAttachment({
      ticketId: freshResolvedTicket.id,
      originalName: 'receipt.pdf',
      mimeType: 'application/pdf',
      content: Buffer.from('Fresh receipt bytes'),
    });

    // 3. Ticket older than 24 hours but still IN_PROGRESS -> should NOT be purged
    const inProgressTicket = await ticketsRepo.create({
      senderEmail: 'waiting@uni.edu',
      subject: 'Ongoing investigation',
      body: 'Still working on this',
      status: 'IN_PROGRESS',
    });
    await testDb.db
      .update(tickets)
      .set({ updatedAt: twentySixHoursAgo, status: 'IN_PROGRESS' })
      .where(eq(tickets.id, inProgressTicket.id));

    const inProgressAttachment = await storageService.saveAttachment({
      ticketId: inProgressTicket.id,
      originalName: 'log.txt',
      mimeType: 'text/plain',
      content: Buffer.from('Server logs from yesterday'),
    });

    // Run purge
    const purgeResult = await cleanupWorker.purgeExpiredAttachments();
    expect(purgeResult.purgedCount).toBe(1);
    expect(purgeResult.bytesFreed).toBeGreaterThan(0);

    // Verify old attachment was unlinked physically and flagged isPurged in DB
    expect(fs.existsSync(oldAttachment.storagePath)).toBe(false);
    const reloadedOld = await storageService.findById(oldAttachment.id);
    expect(reloadedOld!.isPurged).toBe(true);
    expect(reloadedOld!.purgedAt).toBeDefined();

    // Verify ticket record itself was NOT deleted
    const ticketStillExists = await ticketsRepo.findById(oldResolvedTicket.id);
    expect(ticketStillExists).toBeDefined();
    expect(ticketStillExists!.subject).toBe('Old resolved request');

    // Verify fresh resolved attachment physical file was preserved
    expect(fs.existsSync(freshAttachment.storagePath)).toBe(true);
    const reloadedFresh = await storageService.findById(freshAttachment.id);
    expect(reloadedFresh!.isPurged).toBe(false);

    // Verify in-progress ticket attachment physical file was preserved
    expect(fs.existsSync(inProgressAttachment.storagePath)).toBe(true);
    const reloadedInProgress = await storageService.findById(inProgressAttachment.id);
    expect(reloadedInProgress!.isPurged).toBe(false);
  });

  it('HTTP API serves attachment stream when active and returns 410 Gone when purged', async () => {
    const app = buildApp({ db: testDb.db, storageService, enableLogging: false });
    await app.ready();

    const ticket = await ticketsRepo.create({
      senderEmail: 'test@uni.edu',
      subject: 'API Test Ticket',
      body: 'Checking download route',
    });

    const fileContent = 'Sample document content for download test';
    const attachment = await storageService.saveAttachment({
      ticketId: ticket.id,
      originalName: 'notes.txt',
      mimeType: 'text/plain',
      content: Buffer.from(fileContent),
    });

    const staffToken = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'staff@uni.edu', role: 'HelpDesk' });
    const authHeaders = { authorization: `Bearer ${staffToken}` };

    // 1. GET list of attachments
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticket.id}/attachments`,
      headers: authHeaders,
    });
    expect(listRes.statusCode).toBe(200);
    const list = JSON.parse(listRes.payload);
    expect(list.length).toBe(1);
    expect(list[0].originalName).toBe('notes.txt');
    expect(list[0].isPurged).toBe(false);

    // 2. Download active file
    const dlRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticket.id}/attachments/${attachment.id}/download`,
      headers: authHeaders,
    });
    expect(dlRes.statusCode).toBe(200);
    expect(dlRes.payload).toBe(fileContent);
    expect(dlRes.headers['content-disposition']).toContain('notes.txt');

    // 3. Mark as purged
    await storageService.markAsPurged(attachment.id);
    if (fs.existsSync(attachment.storagePath)) {
      fs.unlinkSync(attachment.storagePath);
    }

    // 4. Download after purge -> expect 410 GONE with retention explanation
    const purgedRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticket.id}/attachments/${attachment.id}/download`,
      headers: authHeaders,
    });
    expect(purgedRes.statusCode).toBe(410);
    const errorBody = JSON.parse(purgedRes.payload);
    expect(errorBody.error).toBe('GONE');
    expect(errorBody.message).toContain('retention policy');

    await app.close();
  });
});
