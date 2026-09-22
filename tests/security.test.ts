import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDbInstance } from './test-db.js';
import { buildApp } from '../backend/src/app.js';
import { UsersRepository } from '../backend/src/modules/users/users.repository.js';
import { TicketsRepository } from '../backend/src/modules/tickets/tickets.repository.js';
import { StorageService } from '../backend/src/modules/storage/storage.service.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Application Security Verification (SEC-01 - SEC-06)', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof buildApp>;
  let usersRepo: UsersRepository;
  let ticketsRepo: TicketsRepository;
  let storageService: StorageService;
  const tempDir = path.join(os.tmpdir(), 'test-sec-storage');

  beforeEach(async () => {
    testDb = await createTestDb();
    storageService = new StorageService(testDb.db, tempDir);
    app = buildApp({ db: testDb.db, storageService, enableLogging: false });
    await app.ready();
    usersRepo = new UsersRepository(testDb.db);
    ticketsRepo = new TicketsRepository(testDb.db);
  });


  afterEach(async () => {
    await app.close();
    await testDb.cleanup();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-01: does not expose password hashes in GET /api/users', async () => {
    await usersRepo.create({
      name: 'Secret Agent',
      email: 'agent@corp.local',
      role: 'employee',
      isActive: true,
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789',
    });

    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'agent@corp.local', role: 'employee' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { authorization: `Bearer ${token}` },
    });


    expect(res.statusCode).toBe(200);
    const users = res.json();
    expect(users.length).toBeGreaterThanOrEqual(1);
    for (const user of users) {
      expect(user.passwordHash).toBeUndefined();
      expect(JSON.stringify(user)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    }
  });

  it('SEC-02: protects initial password setup against account takeover and token spoofing', async () => {
    // 1. Create two users needing password setup
    await usersRepo.create({
      name: 'Alice Victim',
      email: 'alice@corp.local',
      role: 'employee',
      isActive: true,
    });
    await usersRepo.create({
      name: 'Bob Attacker',
      email: 'bob@corp.local',
      role: 'employee',
      isActive: true,
    });

    // 2. Probing login returns a signed setup token for Alice
    const probeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@corp.local' },
    });
    expect(probeRes.statusCode).toBe(200);
    const probeBody = probeRes.json();
    expect(probeBody.requiresPasswordSetup).toBe(true);
    expect(probeBody.token).toBeDefined();

    // 3. Trying to use Alice\'s setup token to set Bob\'s password fails with 401
    const hijackAttempt = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      headers: { authorization: `Bearer ${probeBody.token}` },
      payload: {
        email: 'bob@corp.local',
        password: 'evilPassword123',
      },
    });
    expect(hijackAttempt.statusCode).toBe(401);

    // 4. Using Alice\'s setup token for Alice succeeds
    const validSetup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      headers: { authorization: `Bearer ${probeBody.token}` },
      payload: {
        email: 'alice@corp.local',
        password: 'securePassword123',
      },
    });
    expect(validSetup.statusCode).toBe(200);
  });

  it('SEC-03: enforces authentication and authorization on ticket deletion and replies', async () => {
    // Create employee and admin
    const emp = await usersRepo.create({
      name: 'Employee',
      email: 'emp@corp.local',
      role: 'employee',
      isActive: true,
    });
    const admin = await usersRepo.create({
      name: 'Admin',
      email: 'admin@corp.local',
      role: 'admin',
      isActive: true,
    });

    const empSetup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      payload: { email: 'emp@corp.local', password: 'password123' },
    });
    const empToken = empSetup.json().token;

    const adminSetup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      payload: { email: 'admin@corp.local', password: 'password123' },
    });
    const adminToken = adminSetup.json().token;

    // Create ticket
    const ticket = await ticketsRepo.create({
      messageId: '<test-ticket-sec@corp.local>',
      senderEmail: 'cust@corp.local',
      subject: 'Security Check',
      body: 'Check delete permissions',
    });

    // 1. Employee cannot delete ticket (403 Forbidden)
    const empDeleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/${ticket.id}`,
      headers: { authorization: `Bearer ${empToken}` },
    });
    expect(empDeleteRes.statusCode).toBe(403);

    // 2. Invalid bearer token fails with 401
    const invalidDeleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/${ticket.id}`,
      headers: { authorization: 'Bearer invalid-token-string' },
    });
    expect(invalidDeleteRes.statusCode).toBe(401);

    // 3. Employee reply with invalid token fails with 401
    const invalidReplyRes = await app.inject({
      method: 'POST',
      url: `/api/tickets/${ticket.id}/replies`,
      headers: { authorization: 'Bearer invalid-token-string' },
      payload: {
        body: 'Forged reply',
        sender_type: 'EMPLOYEE',
      },
    });
    expect(invalidReplyRes.statusCode).toBe(401);

    // 4. Admin can delete ticket (200 OK)
    const adminDeleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/${ticket.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminDeleteRes.statusCode).toBe(200);
  });

  it('SEC-04: forces attachment disposition and sandbox CSP on non-safe preview types', async () => {
    const ticket = await ticketsRepo.create({
      messageId: '<xss-test@corp.local>',
      senderEmail: 'hacker@corp.local',
      subject: 'Attachment check',
      body: 'Files enclosed',
    });

    const maliciousHtml = Buffer.from('<script>alert("XSS")</script>');
    const htmlAtt = await storageService.saveAttachment({
      ticketId: ticket.id,
      originalName: 'payload.html',
      mimeType: 'text/html',
      content: maliciousHtml,
    });

    const safePng = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const pngAtt = await storageService.saveAttachment({
      ticketId: ticket.id,
      originalName: 'photo.png',
      mimeType: 'image/png',
      content: safePng,
    });

    // 1. Requesting HTML with inline=true must force attachment disposition & sandbox CSP
    const staffToken = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'staff@corp.local', role: 'HelpDesk' });
    const authHeaders = { authorization: `Bearer ${staffToken}` };

    const htmlRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticket.id}/attachments/${htmlAtt.id}/download?inline=true`,
      headers: authHeaders,
    });
    expect(htmlRes.headers['content-disposition']).toContain('attachment');
    expect(htmlRes.headers['content-disposition']).not.toContain('inline');
    expect(htmlRes.headers['x-content-type-options']).toBe('nosniff');
    expect(htmlRes.headers['content-security-policy']).toContain("sandbox");

    // 2. Requesting PNG with inline=true allows safe inline viewing
    const pngRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticket.id}/attachments/${pngAtt.id}/download?inline=true`,
      headers: authHeaders,
    });
    expect(pngRes.headers['content-disposition']).toContain('inline');

    // 3. Requesting without auth header or query token must return 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticket.id}/attachments/${pngAtt.id}/download`,
    });
    expect(unauthRes.statusCode).toBe(401);

    // 4. Requesting with query parameter ?token= must succeed (for browser <img> and <a> downloads)
    const queryAuthRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticket.id}/attachments/${pngAtt.id}/download?token=${staffToken}`,
    });
    expect(queryAuthRes.statusCode).toBe(200);

    const queryListRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticket.id}/attachments?token=${staffToken}`,
    });
    expect(queryListRes.statusCode).toBe(200);
    const listBody = JSON.parse(queryListRes.body);
    expect(listBody.length).toBeGreaterThanOrEqual(2);
  });

  it('SEC-06: JWT tokens contain finite expiration claim (exp)', async () => {
    await usersRepo.create({
      name: 'Expiring User',
      email: 'expiring@corp.local',
      role: 'employee',
      isActive: true,
    });

    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      payload: { email: 'expiring@corp.local', password: 'securePassword123' },
    });
    const token = setupRes.json().token;
    expect(token).toBeDefined();

    // Decode token payload
    const decoded = app.jwt.decode<{ iat?: number; exp?: number }>(token);
    expect(decoded?.exp).toBeDefined();
    expect(decoded?.iat).toBeDefined();
    // Expiration should be roughly 12 hours (43200 seconds) in future
    const lifetime = (decoded?.exp ?? 0) - (decoded?.iat ?? 0);
    expect(lifetime).toBe(43200); // 12 hours in seconds
  });
});
