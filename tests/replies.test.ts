import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, TestDbInstance } from './test-db.js';
import { buildApp } from '../backend/src/app.js';
import { SmtpService } from '../backend/src/modules/email/smtp.service.js';
import { StorageService } from '../backend/src/modules/storage/storage.service.js';

describe('Ticket Replies & Outbound Email Threading', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof buildApp>;
  let mockSmtp: SmtpService;
  let storageService: StorageService;
  let tempStorageDir: string;
  let sentMails: any[];

  beforeEach(async () => {
    testDb = await createTestDb();
    sentMails = [];
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helpdesk-replies-test-'));
    storageService = new StorageService(testDb.db, tempStorageDir);

    // Create SmtpService with spy
    mockSmtp = new SmtpService();
    mockSmtp.sendReply = vi.fn().mockImplementation(async (opts) => {
      const result = {
        messageId: `<smtp-sent-${Date.now()}@helpdesk>`,
        accepted: [opts.to],
      };
      sentMails.push({ opts, result });
      return result;
    });

    app = buildApp({ db: testDb.db, smtpService: mockSmtp, storageService, enableLogging: false });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await testDb.cleanup();
    if (fs.existsSync(tempStorageDir)) {
      fs.rmSync(tempStorageDir, { recursive: true, force: true });
    }
  });

  it('creates customer and employee replies maintaining chronology', async () => {
    // Create initial ticket
    const ticketRes = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'student@example.com',
        subject: 'WiFi issue in library',
        body: 'Cannot connect to Eduroam',
        message_id: '<orig-wifi-101@example.com>',
      },
    });
    const ticketId = ticketRes.json().id;

    // 1. Employee replies
    const empToken = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'staff@example.com', role: 'employee' });
    const empReplyRes = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/replies`,
      headers: { authorization: `Bearer ${empToken}` },
      payload: {
        body: 'Hello, please try forgetting the network and re-entering credentials.',
        sender_type: 'EMPLOYEE',
      },
    });

    expect(empReplyRes.statusCode).toBe(201);
    const empReply = empReplyRes.json();
    expect(empReply.ticketId).toBe(ticketId);
    expect(empReply.senderType).toBe('EMPLOYEE');
    expect(empReply.body).toContain('forgetting the network');

    // Verify SMTP was called for EMPLOYEE reply
    expect(mockSmtp.sendReply).toHaveBeenCalledTimes(1);
    expect(sentMails[0].opts.to).toBe('student@example.com');
    expect(sentMails[0].opts.subject).toBe('Re: WiFi issue in library');
    expect(sentMails[0].opts.inReplyToMessageId).toBe('<orig-wifi-101@example.com>');
    expect(sentMails[0].opts.references).toContain('<orig-wifi-101@example.com>');

    // 2. Customer follows up
    const custReplyRes = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/replies`,
      payload: {
        body: 'Thank you! That resolved my issue.',
        sender_type: 'CUSTOMER',
      },
    });

    expect(custReplyRes.statusCode).toBe(201);
    expect(custReplyRes.json().senderType).toBe('CUSTOMER');
    // SMTP should NOT be called for CUSTOMER replies
    expect(mockSmtp.sendReply).toHaveBeenCalledTimes(1);

    // 3. Fetch all replies in chronological order
    const listRepliesRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}/replies`,
      headers: { authorization: `Bearer ${empToken}` },
    });

    expect(listRepliesRes.statusCode).toBe(200);
    const allReplies = listRepliesRes.json();
    expect(allReplies).toHaveLength(2);
    expect(allReplies[0].senderType).toBe('EMPLOYEE');
    expect(allReplies[1].senderType).toBe('CUSTOMER');
  });

  it('rejects empty reply body with 400 validation error', async () => {
    const ticketRes = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'test@example.com',
        subject: 'Title',
        body: 'Body',
      },
    });
    const ticketId = ticketRes.json().id;

    const emptyReplyRes = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/replies`,
      payload: {
        body: '',
        sender_type: 'EMPLOYEE',
      },
    });

    expect(emptyReplyRes.statusCode).toBe(400);
  });

  it('sends employee reply with attachments via SMTP and stores them in database and storage', async () => {
    const ticketRes = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'student@example.com',
        subject: 'VPN Setup',
        body: 'Need VPN instructions',
        message_id: '<vpn-help-1@example.com>',
      },
    });
    const ticketId = ticketRes.json().id;

    // Base64 encoded test file content
    const sampleText = 'Step 1: Download client. Step 2: Connect to vpn.uni.edu';
    const base64Data = Buffer.from(sampleText).toString('base64');

    const empToken = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'staff@example.com', role: 'employee' });
    const replyRes = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/replies`,
      headers: { authorization: `Bearer ${empToken}` },
      payload: {
        body: 'Please find the VPN configuration guide attached.',
        sender_type: 'EMPLOYEE',
        attachments: [
          {
            original_name: 'vpn_guide.txt',
            mime_type: 'text/plain',
            data: base64Data,
          },
        ],
      },
    });

    expect(replyRes.statusCode).toBe(201);

    // Verify SMTP call received the attachment
    expect(mockSmtp.sendReply).toHaveBeenCalledTimes(1);
    expect(sentMails[0].opts.attachments).toBeDefined();
    expect(sentMails[0].opts.attachments).toHaveLength(1);
    expect(sentMails[0].opts.attachments[0].filename).toBe('vpn_guide.txt');
    expect(sentMails[0].opts.attachments[0].content.toString()).toBe(sampleText);
    expect(sentMails[0].opts.attachments[0].contentType).toBe('text/plain');

    // Verify attachment appears in GET /api/tickets/:id/attachments
    const attRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}/attachments`,
      headers: { authorization: `Bearer ${empToken}` },
    });
    expect(attRes.statusCode).toBe(200);
    const attachments = attRes.json();
    expect(attachments).toHaveLength(1);
    expect(attachments[0].originalName).toBe('vpn_guide.txt');
  });
});

