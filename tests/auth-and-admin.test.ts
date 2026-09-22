import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDbInstance } from './test-db.js';
import { buildApp } from '../backend/src/app.js';
import { UsersRepository } from '../backend/src/modules/users/users.repository.js';
import { TicketsRepository } from '../backend/src/modules/tickets/tickets.repository.js';

describe('Corporate Authentication, RBAC and Admin Panel', () => {
  let testDb: TestDbInstance;
  let app: ReturnType<typeof buildApp>;
  let usersRepo: UsersRepository;
  let ticketsRepo: TicketsRepository;

  beforeEach(async () => {
    testDb = await createTestDb();
    app = buildApp({ db: testDb.db, enableLogging: false });
    usersRepo = new UsersRepository(testDb.db);
    ticketsRepo = new TicketsRepository(testDb.db);
  });

  afterEach(async () => {
    await app.close();
    await testDb.cleanup();
  });

  it('prompts new employee for password creation on first login and authenticates after setup', async () => {
    // 1. Create employee without password
    await usersRepo.create({
      name: 'Boris Engineer',
      email: 'boris@company.local',
      role: 'employee',
      isActive: true,
      passwordHash: null,
    });

    // 2. First login without password prompts for setup
    const firstAttempt = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'boris@company.local' },
    });

    expect(firstAttempt.statusCode).toBe(200);
    const firstBody = firstAttempt.json();
    expect(firstBody.requiresPasswordSetup).toBe(true);
    expect(firstBody.email).toBe('boris@company.local');

    // 3. Setup password
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      payload: {
        email: 'boris@company.local',
        password: 'securePassword123',
      },
    });

    expect(setupRes.statusCode).toBe(200);
    const setupBody = setupRes.json();
    expect(setupBody.token).toBeDefined();
    expect(setupBody.user.email).toBe('boris@company.local');

    // 4. Login with incorrect password fails with 401
    const failLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'boris@company.local',
        password: 'wrongPassword',
      },
    });
    expect(failLogin.statusCode).toBe(401);

    // 5. Login with correct password succeeds
    const successLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'boris@company.local',
        password: 'securePassword123',
      },
    });
    expect(successLogin.statusCode).toBe(200);
    expect(successLogin.json().token).toBeDefined();
  });

  it('verifies /api/auth/me with valid Bearer token', async () => {
    const user = await usersRepo.create({
      name: 'Anna Admin',
      email: 'anna@company.local',
      role: 'admin',
      isActive: true,
    });

    // Setup password & get token
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      payload: { email: 'anna@company.local', password: 'adminPass789!' },
    });
    const token = setupRes.json().token;

    // Check /api/auth/me
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json();
    expect(meBody.id).toBe(user.id);
    expect(meBody.role).toBe('admin');
  });

  it('enforces RBAC: forbids employees from accessing admin routes', async () => {
    await usersRepo.create({
      name: 'Regular Staff',
      email: 'staff@company.local',
      role: 'employee',
      isActive: true,
    });

    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      payload: { email: 'staff@company.local', password: 'staffPassword123' },
    });
    const token = setupRes.json().token;

    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(adminRes.statusCode).toBe(403);
    expect(adminRes.json().error).toBe('FORBIDDEN');
  });

  it('allows admin to list, add, update, and delete staff', async () => {
    await usersRepo.create({
      name: 'Super Admin',
      email: 'admin@company.local',
      role: 'admin',
      isActive: true,
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@company.local', password: 'adminPassword123' },
    });
    const adminToken = loginRes.json().token;

    // 1. Add staff member
    const addRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'New Agent',
        email: 'agent@company.local',
        role: 'employee',
      },
    });
    expect(addRes.statusCode).toBe(201);
    const newStaff = addRes.json();
    expect(newStaff.id).toBeDefined();
    expect(newStaff.email).toBe('agent@company.local');

    // 2. Change role to admin
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${newStaff.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { role: 'admin' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().role).toBe('admin');

    // 3. List staff with stats
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const staffList = listRes.json();
    expect(staffList.length).toBeGreaterThanOrEqual(2);

    // 4. Delete staff member
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${newStaff.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);
  });

  it('scopes tickets to assigned employee when my_tickets=true is passed', async () => {
    const emp1 = await usersRepo.create({
      name: 'Agent 1',
      email: 'agent1@company.local',
      role: 'employee',
      isActive: true,
    });
    const emp2 = await usersRepo.create({
      name: 'Agent 2',
      email: 'agent2@company.local',
      role: 'employee',
      isActive: true,
    });

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      payload: { email: 'agent1@company.local', password: 'mypassword123' },
    });
    const token = tokenRes.json().token;

    // Create ticket for emp1
    await ticketsRepo.create({
      messageId: '<m1@test.com>',
      senderEmail: 'cust1@test.com',
      subject: 'Issue for Agent 1',
      body: 'Details',
      status: 'WAITING',
      priority: 'HIGH',
      assigneeId: emp1.id,
    });

    // Create ticket for emp2
    await ticketsRepo.create({
      messageId: '<m2@test.com>',
      senderEmail: 'cust2@test.com',
      subject: 'Issue for Agent 2',
      body: 'Details',
      status: 'WAITING',
      priority: 'LOW',
      assigneeId: emp2.id,
    });

    // Scoped request for Agent 1
    const scopedRes = await app.inject({
      method: 'GET',
      url: '/api/tickets?my_tickets=true',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(scopedRes.statusCode).toBe(200);
    const data = scopedRes.json().data;
    expect(data.length).toBe(1);
    expect(data[0].subject).toBe('Issue for Agent 1');
    expect(data[0].assigneeId).toBe(emp1.id);
  });

  it('manages custom roles and departments via admin API', async () => {
    // 1. Create and authenticate an admin
    await usersRepo.create({
      name: 'Super Admin',
      email: 'admin@company.local',
      role: 'admin',
      isActive: true,
    });
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/api/auth/setup-password',
      payload: { email: 'admin@company.local', password: 'adminPassword123' },
    });
    const adminToken = tokenRes.json().token;

    // 2. List initial roles
    const listInitial = await app.inject({
      method: 'GET',
      url: '/api/admin/roles',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listInitial.statusCode).toBe(200);
    const initialRoles = listInitial.json();
    expect(initialRoles.some((r: any) => r.name === 'admin')).toBe(true);
    expect(initialRoles.some((r: any) => r.name === 'HelpDesk')).toBe(true);

    // 3. Create a new custom department/role
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/roles',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Департамент регистрации',
        description: 'Registrar Office Support',
        is_admin: false,
      },
    });
    expect(createRes.statusCode).toBe(201);
    const createdRole = createRes.json();
    expect(createdRole.name).toBe('Департамент регистрации');
    expect(createdRole.isAdmin).toBe(false);
    expect(createdRole.isSystem).toBe(false);

    // 4. Create a staff member with this new custom role
    const staffRes = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Aigul Registrar',
        email: 'aigul@astanait.edu.kz',
        role: 'Департамент регистрации',
      },
    });
    expect(staffRes.statusCode).toBe(201);
    expect(staffRes.json().role).toBe('Департамент регистрации');

    // 5. Try deleting role while staff is assigned -> should fail
    const delFail = await app.inject({
      method: 'DELETE',
      url: `/api/admin/roles/${createdRole.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(delFail.statusCode).toBe(400);

    // 6. Try deleting system role 'admin' -> should fail
    const adminRoleObj = initialRoles.find((r: any) => r.name === 'admin');
    if (adminRoleObj) {
      const delSys = await app.inject({
        method: 'DELETE',
        url: `/api/admin/roles/${adminRoleObj.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(delSys.statusCode).toBe(400);
    }

    // 7. Delete employee, then delete role -> should succeed
    const delUser = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${staffRes.json().id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(delUser.statusCode).toBe(200);

    const delSuccess = await app.inject({
      method: 'DELETE',
      url: `/api/admin/roles/${createdRole.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(delSuccess.statusCode).toBe(200);
  });
});
