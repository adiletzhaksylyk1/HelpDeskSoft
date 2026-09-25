import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDbInstance } from './test-db.js';
import { UsersRepository } from '../backend/src/modules/users/users.repository.js';
import { TicketsRepository } from '../backend/src/modules/tickets/tickets.repository.js';
import { TicketsService } from '../backend/src/modules/tickets/tickets.service.js';
import { ImapWorker } from '../backend/src/modules/email/imap.worker.js';
import { tickets } from '../backend/src/db/schema.js';
import { eq } from 'drizzle-orm';


describe('Inbound Email Worker & Deduplication', () => {
  let testDb: TestDbInstance;
  let usersRepo: UsersRepository;
  let ticketsRepo: TicketsRepository;
  let imapWorker: ImapWorker;

  beforeEach(async () => {
    testDb = await createTestDb();
    usersRepo = new UsersRepository(testDb.db);
    ticketsRepo = new TicketsRepository(testDb.db);
    imapWorker = new ImapWorker(ticketsRepo);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it('parses raw email message, extracts envelope, creates ticket and assigns employee', async () => {
    const agent = await usersRepo.create({ name: 'Support Agent', email: 'agent@uni.edu', isActive: true });

    const rawEmail = `From: "Professor Smith" <smith@faculty.uni.edu>
To: support@uni.edu
Subject: Projector broken in Hall B
Message-ID: <faculty-report-2026-99@uni.edu>
Date: Tue, 15 Sep 2026 10:00:00 +0000
Content-Type: text/plain; charset=utf-8

The main projector lamp in lecture hall B is blinking and shuts down after 5 minutes.
Please send assistance before the 2 PM lecture.
`;

    const result = await imapWorker.processIncomingMail(rawEmail);

    expect(result.created).toBe(true);
    expect(result.ticketId).toBeDefined();
    expect(result.messageId).toBe('<faculty-report-2026-99@uni.edu>');

    const createdTicket = await ticketsRepo.findById(result.ticketId!);
    expect(createdTicket).toBeDefined();
    expect(createdTicket!.senderEmail).toBe('smith@faculty.uni.edu');
    expect(createdTicket!.subject).toBe('Projector broken in Hall B');
    expect(createdTicket!.body).toContain('main projector lamp in lecture hall B');
    expect(createdTicket!.status).toBe('WAITING');
    expect(createdTicket!.assigneeId).toBe(agent.id);
  });

  it('safely skips duplicate emails when the same Message-ID arrives again', async () => {
    await usersRepo.create({ name: 'Agent', email: 'agent@example.com', isActive: true });

    const rawEmail = `From: user@client.org
To: help@helpdesk.org
Subject: Account locked
Message-ID: <unique-lockout-msg-12345@client.org>
Content-Type: text/plain; charset=utf-8

My account got locked after 3 attempts.
`;

    // First processing
    const firstRun = await imapWorker.processIncomingMail(rawEmail);
    expect(firstRun.created).toBe(true);
    const initialTicketId = firstRun.ticketId;

    // Second processing with identical email / Message-ID
    const secondRun = await imapWorker.processIncomingMail(rawEmail);
    expect(secondRun.created).toBe(false);
    expect(secondRun.ticketId).toBe(initialTicketId);

    // Verify only 1 ticket exists in database
    const paginated = await ticketsRepo.findMany();
    expect(paginated.total).toBe(1);
  });

  it('keeps a headerless Re: reply in its original ticket and updates the queue', async () => {
    await usersRepo.create({ name: 'Agent', email: 'agent@example.com', isActive: true });
    const original = await imapWorker.processIncomingMail(`From: student@example.kz
To: support@example.kz
Subject: User not found
Message-ID: <user-not-found-1@example.kz>

I cannot sign in.`);
    const followUp = await imapWorker.processIncomingMail(`From: student@example.kz
To: support@example.kz
Subject: Re: User not found
Message-ID: <user-not-found-2@example.kz>

Everything works now, thank you.`);

    expect(followUp.ticketId).toBe(original.ticketId);
    const thread = await ticketsRepo.findById(original.ticketId!);
    expect(thread?.subject).toBe('User not found');
    expect(thread?.replies?.map((reply) => reply.body)).toEqual([
      'Everything works now, thank you.',
    ]);
    const list = await ticketsRepo.findMany();
    expect(list.total).toBe(1);
    expect(list.data[0].latestReplyBody).toBe('Everything works now, thank you.');
    expect(list.data[0].latestReplySenderType).toBe('CUSTOMER');
    expect(list.data[0].replyCount).toBe(1);
    expect((await imapWorker.processIncomingMail(`From: student@example.kz
To: support@example.kz
Subject: Re: User not found
Message-ID: <user-not-found-2@example.kz>

Everything works now, thank you.`)).created).toBe(false);
  });

  it('does not infer a thread from a subject shared by multiple tickets', async () => {
    await usersRepo.create({ name: 'Agent', email: 'agent@example.com', isActive: true });
    for (const id of [1, 2]) {
      await imapWorker.processIncomingMail(`From: student@example.kz
To: support@example.kz
Subject: User not found
Message-ID: <separate-${id}@example.kz>

Request ${id}`);
    }
    const followUp = await imapWorker.processIncomingMail(`From: student@example.kz
To: support@example.kz
Subject: Re: User not found
Message-ID: <ambiguous@example.kz>

Follow up`);
    expect(followUp.created).toBe(true);
    expect((await ticketsRepo.findMany()).total).toBe(3);
  });

  it('reconciles an existing Re: ticket into the original conversation', async () => {
    await usersRepo.create({ name: 'Agent', email: 'agent@example.com', isActive: true });
    const root = await ticketsRepo.create({
      senderEmail: 'student@example.kz', subject: 'User not found', body: 'Please help',
      messageId: '<root-reconcile@example.kz>',
    });
    const duplicate = await ticketsRepo.create({
      senderEmail: 'student@example.kz', subject: 'Re: User not found', body: 'Thank you',
      messageId: '<reply-reconcile@example.kz>',
    });
    await testDb.db.update(tickets).set({ createdAt: new Date(root.createdAt.getTime() + 1000) })
      .where(eq(tickets.id, duplicate.id));

    expect(await ticketsRepo.reconcileReplyTickets()).toBe(1);
    expect(await ticketsRepo.reconcileReplyTickets()).toBe(0);
    expect((await ticketsRepo.findMany()).total).toBe(1);
    expect((await ticketsRepo.findById(root.id))?.replies?.[0].messageId)
      .toBe('<reply-reconcile@example.kz>');
    expect((await ticketsRepo.findReplyByMessageId(duplicate.messageId))?.ticketId).toBe(root.id);
  });

  it('does NOT recreate a ticket if it was deleted by the user', async () => {
    await usersRepo.create({ name: 'Agent', email: 'agent@example.com', isActive: true });

    const rawEmail = `From: applicant@example.kz
To: support@aitu.edu.kz
Subject: Admission inquiry
Message-ID: <aitu-adm-inquiry-777@example.kz>
Content-Type: text/plain; charset=utf-8

Hello, where can I submit my documents?
`;

    // 1. First fetch creates the ticket
    const initialRun = await imapWorker.processIncomingMail(rawEmail);
    expect(initialRun.created).toBe(true);
    expect(initialRun.ticketId).toBeDefined();

    const ticketsService = new TicketsService(ticketsRepo);

    // 2. User deletes the ticket
    const deleted = await ticketsService.deleteTicket(initialRun.ticketId!);
    expect(deleted).toBe(true);

    // Verify ticket is no longer in active tickets table
    const ticketInDb = await ticketsRepo.findById(initialRun.ticketId!);
    expect(ticketInDb).toBeNull();

    // 3. User or worker triggers fetch again for the same raw email
    const secondRun = await imapWorker.processIncomingMail(rawEmail);
    expect(secondRun.created).toBe(false);
    expect(secondRun.messageId).toBe('<aitu-adm-inquiry-777@example.kz>');

    // 4. Verify no new ticket was created in the database
    const paginated = await ticketsRepo.findMany();
    expect(paginated.total).toBe(0);
  });

  it('does NOT create a ticket if an incoming email replies to a deleted ticket', async () => {
    await usersRepo.create({ name: 'Agent', email: 'agent@example.com', isActive: true });

    const initialEmail = `From: student@example.kz
To: support@aitu.edu.kz
Subject: Dormitory room key
Message-ID: <dorm-key-orig-100@example.kz>
Content-Type: text/plain; charset=utf-8

I need a spare room key.
`;

    const initialRun = await imapWorker.processIncomingMail(initialEmail);
    expect(initialRun.created).toBe(true);

    const ticketsService = new TicketsService(ticketsRepo);
    await ticketsService.deleteTicket(initialRun.ticketId!);

    // Follow-up email replying to the deleted thread
    const replyEmail = `From: student@example.kz
To: support@aitu.edu.kz
Subject: Re: Dormitory room key
Message-ID: <dorm-key-reply-101@example.kz>
In-Reply-To: <dorm-key-orig-100@example.kz>
Content-Type: text/plain; charset=utf-8

Never mind, I found my key in my jacket.
`;

    const replyRun = await imapWorker.processIncomingMail(replyEmail);
    expect(replyRun.created).toBe(false);

    const paginated = await ticketsRepo.findMany();
    expect(paginated.total).toBe(0);
  });
});
