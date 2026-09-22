import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDbInstance } from './test-db.js';
import { MailboxesRepository } from '../backend/src/modules/mailboxes/mailboxes.repository.js';
import { TicketsRepository } from '../backend/src/modules/tickets/tickets.repository.js';
import { UsersRepository } from '../backend/src/modules/users/users.repository.js';
import { ImapWorker } from '../backend/src/modules/email/imap.worker.js';
import { SmtpService } from '../backend/src/modules/email/smtp.service.js';
import { buildApp } from '../backend/src/app.js';
import type { FastifyInstance } from 'fastify';

describe('Multi-Mailbox Management, Ingestion & Routing', () => {
  let testDb: TestDbInstance;
  let mailboxesRepo: MailboxesRepository;
  let ticketsRepo: TicketsRepository;
  let usersRepo: UsersRepository;
  let imapWorker: ImapWorker;
  let app: FastifyInstance;
  let adminToken: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    mailboxesRepo = new MailboxesRepository(testDb.db);
    ticketsRepo = new TicketsRepository(testDb.db);
    usersRepo = new UsersRepository(testDb.db);
    imapWorker = new ImapWorker(ticketsRepo, undefined, mailboxesRepo);

    app = buildApp({
      db: testDb.db,
      mailboxesRepo,
      imapWorker,
      enableLogging: false,
    });
    await app.ready();

    // Create admin and generate token
    const admin = await usersRepo.create({
      name: 'System Admin',
      email: 'admin@uni.edu',
      role: 'admin',
      isActive: true,
      passwordHash: 'hash',
    });
    adminToken = app.jwt.sign({ id: admin.id, email: admin.email, role: admin.role });
  });

  afterEach(async () => {
    await app.close();
    await testDb.cleanup();
  });

  it('performs CRUD on mailboxes repository and masks passwords in safe view', async () => {
    const created = await mailboxesRepo.create({
      name: 'Department of University Support',
      email: 'support_du@astanait.edu.kz',
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapUser: 'support_du@astanait.edu.kz',
      imapPassword: 'secret_imap_password',
      imapSecure: true,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpUser: 'support_du@astanait.edu.kz',
      smtpPassword: 'secret_smtp_password',
      smtpSecure: false,
      isActive: true,
      lastSyncAt: null,
      lastSyncError: null,
    });

    expect(created.id).toBeDefined();
    expect(created.email).toBe('support_du@astanait.edu.kz');

    const safe = mailboxesRepo.toSafeMailbox(created);
    expect((safe as any).imapPassword).toBeUndefined();
    expect((safe as any).smtpPassword).toBeUndefined();
    expect(safe.hasImapPassword).toBe(true);
    expect(safe.hasSmtpPassword).toBe(true);

    const activeList = await mailboxesRepo.findActive();
    expect(activeList.length).toBe(1);

    // Update mailbox
    const updated = await mailboxesRepo.update(created.id, { name: 'Astana IT DU Support' });
    expect(updated?.name).toBe('Astana IT DU Support');

    // Update sync status
    await mailboxesRepo.updateSyncStatus(created.id, 'Authentication error (test)');
    const withError = await mailboxesRepo.findById(created.id);
    expect(withError?.lastSyncError).toBe('Authentication error (test)');
    expect(withError?.lastSyncAt).toBeDefined();
  });

  it('tags incoming tickets with mailboxId and recipientEmail during email ingestion', async () => {
    await usersRepo.create({ name: 'Agent', email: 'agent@astanait.edu.kz', isActive: true });

    const mailbox = await mailboxesRepo.create({
      name: 'General Helpdesk',
      email: 'helpdesk@astanait.edu.kz',
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      imapUser: 'helpdesk@astanait.edu.kz',
      imapPassword: 'pass',
      imapSecure: true,
      smtpHost: 'smtp.office365.com',
      smtpPort: 587,
      smtpUser: 'helpdesk@astanait.edu.kz',
      smtpPassword: 'pass',
      smtpSecure: false,
      isActive: true,
      lastSyncAt: null,
      lastSyncError: null,
    });

    const rawEmail = `From: "Student Alibek" <alibek@astanait.edu.kz>
To: helpdesk@astanait.edu.kz
Subject: Canvas LMS login issue
Message-ID: <student-ticket-101@astanait.edu.kz>
Content-Type: text/plain; charset=utf-8

Cannot sign in to Canvas LMS since yesterday morning.
`;

    const result = await imapWorker.processIncomingMail(rawEmail, {
      mailboxId: mailbox.id,
      recipientEmail: mailbox.email,
    });

    expect(result.created).toBe(true);
    const ticket = await ticketsRepo.findById(result.ticketId!);
    expect(ticket).toBeDefined();
    expect(ticket?.mailboxId).toBe(mailbox.id);
    expect(ticket?.recipientEmail).toBe('helpdesk@astanait.edu.kz');
    expect(ticket?.senderEmail).toBe('alibek@astanait.edu.kz');
    expect(ticket?.subject).toBe('Canvas LMS login issue');

    // Verify filtering tickets by mailboxId
    const filtered = await ticketsRepo.findMany({ mailboxId: mailbox.id });
    expect(filtered.total).toBe(1);

    const nonExistentFilter = await ticketsRepo.findMany({ mailboxId: '00000000-0000-0000-0000-000000000000' });
    expect(nonExistentFilter.total).toBe(0);
  });

  it('exposes public channels and admin REST API endpoints for mailbox management', async () => {
    // 1. Create mailbox via admin API
    const postRes = await app.inject({
      method: 'POST',
      url: '/api/admin/mailboxes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Dean Support',
        email: 'dean_office@astanait.edu.kz',
        imapHost: 'outlook.office365.com',
        imapPort: 993,
        imapUser: 'dean_office@astanait.edu.kz',
        imapPassword: 'mypassword123',
        imapSecure: true,
        smtpHost: 'smtp.office365.com',
        smtpPort: 587,
        smtpUser: 'dean_office@astanait.edu.kz',
        smtpPassword: 'mypassword123',
        smtpSecure: false,
        isActive: true,
      },
    });

    expect(postRes.statusCode).toBe(201);
    const created = JSON.parse(postRes.payload);
    expect(created.id).toBeDefined();
    expect(created.email).toBe('dean_office@astanait.edu.kz');
    expect(created.hasImapPassword).toBe(true);

    // 2. Public list of active channels
    const channelsRes = await app.inject({
      method: 'GET',
      url: '/api/mailboxes',
    });
    expect(channelsRes.statusCode).toBe(200);
    const channels = JSON.parse(channelsRes.payload);
    expect(channels.length).toBe(1);
    expect(channels[0].name).toBe('Dean Support');

    // 3. Admin list includes status and masked passwords
    const adminListRes = await app.inject({
      method: 'GET',
      url: '/api/admin/mailboxes',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminListRes.statusCode).toBe(200);
    const adminList = JSON.parse(adminListRes.payload);
    expect(adminList.length).toBe(1);
    expect(adminList[0].imapPassword).toBeUndefined();

    // 4. Update mailbox
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/mailboxes/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Dean Office Support Center' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.payload).name).toBe('Dean Office Support Center');

    // 5. Delete mailbox
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/mailboxes/${created.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteRes.statusCode).toBe(200);

    const emptyList = await mailboxesRepo.findAll();
    expect(emptyList.length).toBe(0);
  });

  it('supports Microsoft 365 Graph provider with secret masking and connection testing', async () => {
    // 1. Create a Microsoft Graph mailbox via Admin API
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/mailboxes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'AITU Corporate Graph Mailbox',
        email: 'a.zhaksylyk@astanait.edu.kz',
        provider: 'graph',
        msTenantId: '158f15f3-83e0-4906-824c-69bdc50d9d61',
        msClientId: '76dd36fa-2bd9-4621-8afe-a9ad169f6b69',
        msClientSecret: 'test_client_secret_xyz',
        isActive: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.payload);
    expect(created.provider).toBe('graph');
    expect(created.email).toBe('a.zhaksylyk@astanait.edu.kz');
    expect((created as any).msClientSecret).toBeUndefined();
    expect(created.hasMsClientSecret).toBe(true);

    // 2. Admin list check
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/mailboxes',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const list = JSON.parse(listRes.payload);
    const found = list.find((m: any) => m.id === created.id);
    expect(found).toBeDefined();
    expect(found.provider).toBe('graph');
    expect(found.msClientSecret).toBeUndefined();
    expect(found.hasMsClientSecret).toBe(true);

    // 3. Test connection endpoint with missing fields
    const testBadRes = await app.inject({
      method: 'POST',
      url: '/api/admin/mailboxes/test-connection',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        provider: 'graph',
        email: 'a.zhaksylyk@astanait.edu.kz',
        // missing credentials
      },
    });
    expect(testBadRes.statusCode).toBe(400);
    const badData = JSON.parse(testBadRes.payload);
    expect(badData.success).toBe(false);
  });

  it('supports multiple target roles on mailbox and routes tickets to active employees in any assigned role', async () => {
    // 1. Create employees with distinct roles
    const emp1 = await usersRepo.create({
      name: 'Helpdesk Agent',
      email: 'hd@uni.edu',
      role: 'HelpDesk',
      isActive: true,
      passwordHash: 'hash',
    });
    const emp2 = await usersRepo.create({
      name: 'DU Support Agent',
      email: 'du@uni.edu',
      role: 'MyDU support',
      isActive: true,
      passwordHash: 'hash',
    });

    // 2. Create mailbox with multiple roles
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/mailboxes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Combined Student Support',
        email: 'support_combined@uni.edu',
        target_role: 'HelpDesk, MyDU support',
        provider: 'graph',
        msTenantId: 'tid',
        msClientId: 'cid',
        msClientSecret: 'csec',
        isActive: true,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdMb = JSON.parse(createRes.payload);
    expect(createdMb.targetRole).toBe('HelpDesk, MyDU support');

    // 3. Test routing through ticketsRepo.findLeastBusyActiveEmployeeId
    const assignedId = await ticketsRepo.findLeastBusyActiveEmployeeId('HelpDesk, MyDU support');
    expect([emp1.id, emp2.id]).toContain(assignedId);

    // 4. Update mailbox target roles via PATCH
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/mailboxes/${createdMb.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        target_role: 'MyDU support',
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.payload).targetRole).toBe('MyDU support');

    const updatedAssignedId = await ticketsRepo.findLeastBusyActiveEmployeeId('MyDU support');
    expect(updatedAssignedId).toBe(emp2.id);
  });
});


