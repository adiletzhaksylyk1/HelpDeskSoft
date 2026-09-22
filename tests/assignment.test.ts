import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDbInstance } from './test-db.js';
import { UsersRepository } from '../backend/src/modules/users/users.repository.js';
import { TicketsRepository } from '../backend/src/modules/tickets/tickets.repository.js';
import { TicketsService } from '../backend/src/modules/tickets/tickets.service.js';
import { MailboxesRepository } from '../backend/src/modules/mailboxes/mailboxes.repository.js';

describe('Automatic Ticket Assignment Logic', () => {
  let testDb: TestDbInstance;
  let usersRepo: UsersRepository;
  let ticketsRepo: TicketsRepository;
  let ticketsService: TicketsService;

  beforeEach(async () => {
    testDb = await createTestDb();
    usersRepo = new UsersRepository(testDb.db);
    ticketsRepo = new TicketsRepository(testDb.db);
    ticketsService = new TicketsService(ticketsRepo);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it('assigns ticket to the active employee with the smallest number of active tickets', async () => {
    // Setup employees: Ivan, Vasily, Alex
    const ivan = await usersRepo.create({ name: 'Ivan', email: 'ivan@example.com', isActive: true });
    const vasily = await usersRepo.create({ name: 'Vasily', email: 'vasily@example.com', isActive: true });
    const alex = await usersRepo.create({ name: 'Alex', email: 'alex@example.com', isActive: true });

    // Ivan has 5 active tickets
    for (let i = 0; i < 5; i++) {
      await ticketsRepo.create({
        messageId: `<ivan-${i}@test.com>`,
        senderEmail: 'client@example.com',
        subject: `Ivan task ${i}`,
        body: 'Details',
        status: 'IN_PROGRESS',
        assigneeId: ivan.id,
      });
    }

    // Vasily has 2 active tickets
    for (let i = 0; i < 2; i++) {
      await ticketsRepo.create({
        messageId: `<vasily-${i}@test.com>`,
        senderEmail: 'client@example.com',
        subject: `Vasily task ${i}`,
        body: 'Details',
        status: 'WAITING',
        assigneeId: vasily.id,
      });
    }

    // Alex has 4 active tickets
    for (let i = 0; i < 4; i++) {
      await ticketsRepo.create({
        messageId: `<alex-${i}@test.com>`,
        senderEmail: 'client@example.com',
        subject: `Alex task ${i}`,
        body: 'Details',
        status: 'IN_PROGRESS',
        assigneeId: alex.id,
      });
    }

    // New ticket should be assigned to Vasily (smallest active count = 2)
    const newTicket = await ticketsService.createTicket({
      senderEmail: 'customer@domain.com',
      subject: 'Urgent printer issue',
      body: 'Printer paper jam',
    });

    expect(newTicket.assigneeId).toBe(vasily.id);
  });

  it('ignores RESOLVED tickets when calculating active workload', async () => {
    const userA = await usersRepo.create({ name: 'Alice', email: 'alice@example.com', isActive: true });
    const userB = await usersRepo.create({ name: 'Bob', email: 'bob@example.com', isActive: true });

    // Alice has 3 tickets, but 2 are RESOLVED (1 active)
    await ticketsRepo.create({
      messageId: '<alice-1@test.com>',
      senderEmail: 'c1@test.com',
      subject: 'Issue 1',
      body: 'body',
      status: 'RESOLVED',
      assigneeId: userA.id,
    });
    await ticketsRepo.create({
      messageId: '<alice-2@test.com>',
      senderEmail: 'c2@test.com',
      subject: 'Issue 2',
      body: 'body',
      status: 'RESOLVED',
      assigneeId: userA.id,
    });
    await ticketsRepo.create({
      messageId: '<alice-3@test.com>',
      senderEmail: 'c3@test.com',
      subject: 'Issue 3',
      body: 'body',
      status: 'WAITING',
      assigneeId: userA.id,
    });

    // Bob has 2 tickets, both IN_PROGRESS (2 active)
    await ticketsRepo.create({
      messageId: '<bob-1@test.com>',
      senderEmail: 'c4@test.com',
      subject: 'Issue 4',
      body: 'body',
      status: 'IN_PROGRESS',
      assigneeId: userB.id,
    });
    await ticketsRepo.create({
      messageId: '<bob-2@test.com>',
      senderEmail: 'c5@test.com',
      subject: 'Issue 5',
      body: 'body',
      status: 'IN_PROGRESS',
      assigneeId: userB.id,
    });

    // Alice has 1 active ticket, Bob has 2. New ticket goes to Alice.
    const newTicket = await ticketsService.createTicket({
      senderEmail: 'c6@test.com',
      subject: 'Network outage',
      body: 'Cannot reach wifi',
    });

    expect(newTicket.assigneeId).toBe(userA.id);
  });

  it('leaves ticket unassigned if no active employees exist', async () => {
    // Inactive employee should not be assigned
    await usersRepo.create({ name: 'Inactive Bob', email: 'bob.inactive@example.com', isActive: false });

    const newTicket = await ticketsService.createTicket({
      senderEmail: 'c@test.com',
      subject: 'Question',
      body: 'How to login?',
    });

    expect(newTicket.assigneeId).toBeNull();
  });

  it('routes and assigns tickets to staff matching the mailbox target role', async () => {
    const mailboxesRepo = new MailboxesRepository(testDb.db);

    // Setup staff in different departments
    const alexHelpdesk = await usersRepo.create({
      name: 'Alex HD',
      email: 'alex.hd@example.com',
      role: 'HelpDesk',
      isActive: true,
    });
    const aidaDu = await usersRepo.create({
      name: 'Aida DU',
      email: 'aida.du@example.com',
      role: 'MyDU support',
      isActive: true,
    });

    // Connect mailboxes with target roles
    const duMailbox = await mailboxesRepo.create({
      name: 'MyDU Support Channel',
      email: 'support_du@astanait.edu.kz',
      provider: 'imap',
      targetRole: 'MyDU support',
      imapHost: 'imap.example.com',
      imapUser: 'support_du@astanait.edu.kz',
      imapPassword: 'pwd',
      isActive: true,
    });

    const hdMailbox = await mailboxesRepo.create({
      name: 'HelpDesk Channel',
      email: 'helpdesk@astanait.edu.kz',
      provider: 'imap',
      targetRole: 'HelpDesk',
      imapHost: 'imap.example.com',
      imapUser: 'helpdesk@astanait.edu.kz',
      imapPassword: 'pwd',
      isActive: true,
    });

    // 1. Incoming ticket on DU mailbox -> auto-assigned to Aida (MyDU support)
    const duTicket = await ticketsService.createTicket({
      senderEmail: 'student@astanait.edu.kz',
      subject: 'Cannot login to MyDU portal',
      body: 'Invalid credentials error',
      mailboxId: duMailbox.id,
    });
    expect(duTicket.assigneeId).toBe(aidaDu.id);

    // 2. Incoming ticket on Helpdesk mailbox -> auto-assigned to Alex (HelpDesk)
    const hdTicket = await ticketsService.createTicket({
      senderEmail: 'teacher@astanait.edu.kz',
      subject: 'Projector broken in C1.1.256',
      body: 'HDMI cable loose',
      mailboxId: hdMailbox.id,
    });
    expect(hdTicket.assigneeId).toBe(alexHelpdesk.id);
  });
});
