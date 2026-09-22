import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDbInstance } from './test-db.js';
import { buildApp } from '../backend/src/app.js';
import { UsersRepository } from '../backend/src/modules/users/users.repository.js';

describe('Tickets REST API & Management', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof buildApp>;
  let usersRepo: UsersRepository;
  let staffToken: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    app = buildApp({ db: testDb.db, enableLogging: false });
    await app.ready();
    usersRepo = new UsersRepository(testDb.db);
    staffToken = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'staff@uni.edu', role: 'employee' });
  });


  afterEach(async () => {
    await app.close();
    await testDb.cleanup();
  });

  it('creates ticket via API with auto-assignment and valid response structure', async () => {
    const employee = await usersRepo.create({ name: 'Elena', email: 'elena@example.com', isActive: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'customer@client.com',
        subject: 'VPN Connection Lost',
        body: 'Cannot reach internal intranet servers',
        message_id: '<vpn-msg-1@client.com>',
        priority: 'HIGH',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.messageId).toBe('<vpn-msg-1@client.com>');
    expect(body.senderEmail).toBe('customer@client.com');
    expect(body.status).toBe('WAITING');
    expect(body.priority).toBe('HIGH');
    expect(body.assigneeId).toBe(employee.id);
  });

  it('rejects duplicate Message-ID with 409 Conflict', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'user@example.com',
        subject: 'First Attempt',
        body: 'Initial report',
        message_id: '<duplicate-msg-id-100@example.com>',
      },
    });

    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'user@example.com',
        subject: 'Second Attempt with Same Message-ID',
        body: 'Duplicated message content',
        message_id: '<duplicate-msg-id-100@example.com>',
      },
    });

    expect(duplicateRes.statusCode).toBe(409);
    expect(duplicateRes.json().error).toBe('CONFLICT');
  });

  it('retrieves ticket details by ID with assignee info', async () => {
    const employee = await usersRepo.create({ name: 'Dmitry', email: 'dmitry@example.com', isActive: true });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'student@uni.edu',
        subject: 'Password Reset Request',
        body: 'Forgot my portal credentials',
        message_id: '<pass-reset-01@uni.edu>',
      },
    });
    const createdId = createRes.json().id;

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${createdId}`,
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(getRes.statusCode).toBe(200);
    const ticket = getRes.json();
    expect(ticket.id).toBe(createdId);
    expect(ticket.subject).toBe('Password Reset Request');
    expect(ticket.assignee).toBeDefined();
    expect(ticket.assignee.id).toBe(employee.id);
    expect(ticket.assignee.name).toBe('Dmitry');
  });

  it('returns 404 for non-existent ticket ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/tickets/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${staffToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });


  it('updates ticket status and priority via PATCH /api/tickets/:id', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'admin@uni.edu',
        subject: 'Server overheating',
        body: 'AC unit failed in server room',
        message_id: '<ac-fail-1@uni.edu>',
        priority: 'MEDIUM',
      },
    });
    const ticketId = createRes.json().id;
    const adminToken = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'admin@corp.local', role: 'admin' });

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/tickets/${ticketId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        status: 'IN_PROGRESS',
        priority: 'CRITICAL',
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const updated = updateRes.json();
    expect(updated.status).toBe('IN_PROGRESS');
    expect(updated.priority).toBe('CRITICAL');

    // Transition to RESOLVED
    const resolveRes = await app.inject({
      method: 'PATCH',
      url: `/api/tickets/${ticketId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        status: 'RESOLVED',
      },
    });

    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().status).toBe('RESOLVED');
  });

  it('reassigns ticket via PATCH /api/tickets/:id/assign', async () => {
    const emp1 = await usersRepo.create({ name: 'Staff One', email: 'one@example.com', isActive: true });
    const emp2 = await usersRepo.create({ name: 'Staff Two', email: 'two@example.com', isActive: true });
    const adminToken = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'admin@corp.local', role: 'admin' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'test@example.com',
        subject: 'Task',
        body: 'Details',
        assignee_id: emp1.id,
      },
    });
    const ticketId = createRes.json().id;

    // Reassign to emp2
    const assignRes = await app.inject({
      method: 'PATCH',
      url: `/api/tickets/${ticketId}/assign`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        assignee_id: emp2.id,
      },
    });

    expect(assignRes.statusCode).toBe(200);
    expect(assignRes.json().assigneeId).toBe(emp2.id);
  });

  it('deletes ticket via DELETE /api/tickets/:id', async () => {
    const adminToken = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', email: 'admin@corp.local', role: 'admin' });
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: {
        sender_email: 'delete-me@example.com',
        subject: 'Delete Target Ticket',
        body: 'To be removed',
      },
    });
    const ticketId = createRes.json().id;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/tickets/${ticketId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/tickets/${ticketId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(getRes.statusCode).toBe(404);

  });
});

