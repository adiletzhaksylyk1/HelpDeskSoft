import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDbInstance } from './test-db.js';
import { buildApp } from '../backend/src/app.js';
import { UsersRepository } from '../backend/src/modules/users/users.repository.js';
import { TicketsRepository } from '../backend/src/modules/tickets/tickets.repository.js';

describe('Ticket Filtering & Pagination', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof buildApp>;
  let usersRepo: UsersRepository;
  let ticketsRepo: TicketsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    app = buildApp({ db: testDb.db, enableLogging: false });
    await app.ready();
    usersRepo = new UsersRepository(testDb.db);
    ticketsRepo = new TicketsRepository(testDb.db);
  });

  afterEach(async () => {
    await app.close();
    await testDb.cleanup();
  });

  it('filters tickets by status, priority, and assignee', async () => {
    const userA = await usersRepo.create({ name: 'Agent A', email: 'agentA@example.com', isActive: true });
    const userB = await usersRepo.create({ name: 'Agent B', email: 'agentB@example.com', isActive: true });

    // Seed 4 tickets with varied attributes
    await ticketsRepo.create({
      messageId: '<m1@test.com>',
      senderEmail: 'c1@test.com',
      subject: 'T1',
      body: 'B1',
      status: 'WAITING',
      priority: 'LOW',
      assigneeId: userA.id,
    });
    await ticketsRepo.create({
      messageId: '<m2@test.com>',
      senderEmail: 'c2@test.com',
      subject: 'T2',
      body: 'B2',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assigneeId: userA.id,
    });
    await ticketsRepo.create({
      messageId: '<m3@test.com>',
      senderEmail: 'c3@test.com',
      subject: 'T3',
      body: 'B3',
      status: 'RESOLVED',
      priority: 'HIGH',
      assigneeId: userB.id,
    });
    await ticketsRepo.create({
      messageId: '<m4@test.com>',
      senderEmail: 'c4@test.com',
      subject: 'T4',
      body: 'B4',
      status: 'WAITING',
      priority: 'CRITICAL',
      assigneeId: userB.id,
    });

    const authHeaders = { authorization: `Bearer ${app.jwt.sign({ id: userA.id, email: userA.email, role: 'employee' })}` };

    // Filter by status=WAITING
    const waitingRes = await app.inject({
      method: 'GET',
      url: '/api/tickets?status=WAITING',
      headers: authHeaders,
    });
    expect(waitingRes.statusCode).toBe(200);
    const waitingBody = waitingRes.json();
    expect(waitingBody.total).toBe(2);
    expect(waitingBody.data.every((t: any) => t.status === 'WAITING')).toBe(true);

    // Filter by priority=HIGH
    const highRes = await app.inject({
      method: 'GET',
      url: '/api/tickets?priority=HIGH',
      headers: authHeaders,
    });
    expect(highRes.statusCode).toBe(200);
    const highBody = highRes.json();
    expect(highBody.total).toBe(2);
    expect(highBody.data.every((t: any) => t.priority === 'HIGH')).toBe(true);

    // Filter by assignee=userA.id
    const userARes = await app.inject({
      method: 'GET',
      url: `/api/tickets?assignee=${userA.id}`,
      headers: authHeaders,
    });
    expect(userARes.statusCode).toBe(200);
    const userABody = userARes.json();
    expect(userABody.total).toBe(2);
    expect(userABody.data.every((t: any) => t.assigneeId === userA.id)).toBe(true);

    // Combined filter: status=IN_PROGRESS and priority=HIGH
    const combinedRes = await app.inject({
      method: 'GET',
      url: '/api/tickets?status=IN_PROGRESS&priority=HIGH',
      headers: authHeaders,
    });
    expect(combinedRes.statusCode).toBe(200);
    const combinedBody = combinedRes.json();
    expect(combinedBody.total).toBe(1);
    expect(combinedBody.data[0].subject).toBe('T2');
  });

  it('correctly applies pagination limits and page offsets', async () => {
    const authHeaders = { authorization: `Bearer ${app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'staff@example.com', role: 'employee' })}` };

    // Seed 15 tickets
    for (let i = 1; i <= 15; i++) {
      await ticketsRepo.create({
        messageId: `<batch-msg-${i}@test.com>`,
        senderEmail: `user${i}@test.com`,
        subject: `Ticket #${i}`,
        body: `Description #${i}`,
        status: 'WAITING',
        priority: 'MEDIUM',
      });
    }

    // Page 1 with limit 5
    const page1Res = await app.inject({
      method: 'GET',
      url: '/api/tickets?page=1&limit=5',
      headers: authHeaders,
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = page1Res.json();
    expect(page1.total).toBe(15);
    expect(page1.totalPages).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(5);
    expect(page1.data).toHaveLength(5);

    // Page 2 with limit 5
    const page2Res = await app.inject({
      method: 'GET',
      url: '/api/tickets?page=2&limit=5',
      headers: authHeaders,
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = page2Res.json();
    expect(page2.page).toBe(2);
    expect(page2.data).toHaveLength(5);

    // Ensure items on page 1 and page 2 are distinct
    const idsPage1 = new Set(page1.data.map((t: any) => t.id));
    const idsPage2 = new Set(page2.data.map((t: any) => t.id));
    for (const id of idsPage2) {
      expect(idsPage1.has(id)).toBe(false);
    }

    // Page 3 with limit 5
    const page3Res = await app.inject({
      method: 'GET',
      url: '/api/tickets?page=3&limit=5',
      headers: authHeaders,
    });
    expect(page3Res.statusCode).toBe(200);
    expect(page3Res.json().data).toHaveLength(5);
  });
});
