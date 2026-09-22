import { pgTable, uuid, text, boolean, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import crypto from 'node:crypto';

export const TICKET_STATUSES = ['WAITING', 'IN_PROGRESS', 'RESOLVED'] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TicketPriority = typeof TICKET_PRIORITIES[number];

export const SENDER_TYPES = ['CUSTOMER', 'EMPLOYEE'] as const;
export type SenderType = typeof SENDER_TYPES[number];

export const users = pgTable('users', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('HelpDesk'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('users_is_active_idx').on(table.isActive),
  uniqueIndex('users_email_idx').on(table.email),
]);

export const MAILBOX_PROVIDERS = ['imap', 'graph'] as const;
export type MailboxProvider = typeof MAILBOX_PROVIDERS[number];

export const mailboxes = pgTable('mailboxes', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  provider: text('provider', { enum: MAILBOX_PROVIDERS }).notNull().default('imap'),
  msTenantId: text('ms_tenant_id'),
  msClientId: text('ms_client_id'),
  msClientSecret: text('ms_client_secret'),
  imapHost: text('imap_host').notNull().default(''),
  imapPort: integer('imap_port').notNull().default(993),
  imapUser: text('imap_user').notNull().default(''),
  imapPassword: text('imap_password').notNull().default(''),
  imapSecure: boolean('imap_secure').notNull().default(true),
  smtpHost: text('smtp_host').notNull().default(''),
  smtpPort: integer('smtp_port').notNull().default(587),
  smtpUser: text('smtp_user').notNull().default(''),
  smtpPassword: text('smtp_password').notNull().default(''),
  smtpSecure: boolean('smtp_secure').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  targetRole: text('target_role'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastSyncError: text('last_sync_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('mailboxes_email_idx').on(table.email),
  index('mailboxes_is_active_idx').on(table.isActive),
  index('mailboxes_provider_idx').on(table.provider),
]);

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  messageId: text('message_id').notNull().unique(),
  senderEmail: text('sender_email').notNull(),
  recipientEmail: text('recipient_email'),
  mailboxId: uuid('mailbox_id').references(() => mailboxes.id, { onDelete: 'set null' }),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status', { enum: TICKET_STATUSES }).notNull().default('WAITING'),
  priority: text('priority', { enum: TICKET_PRIORITIES }).notNull().default('MEDIUM'),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('tickets_message_id_idx').on(table.messageId),
  index('tickets_status_idx').on(table.status),
  index('tickets_priority_idx').on(table.priority),
  index('tickets_assignee_id_idx').on(table.assigneeId),
  index('tickets_mailbox_id_idx').on(table.mailboxId),
  index('tickets_recipient_email_idx').on(table.recipientEmail),
  index('tickets_created_at_idx').on(table.createdAt),
]);

export const ticketReplies = pgTable('ticket_replies', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id'),
  authorName: text('author_name'),
  messageId: text('message_id'),
  body: text('body').notNull(),
  senderType: text('sender_type', { enum: SENDER_TYPES }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('replies_ticket_id_idx').on(table.ticketId),
  index('replies_created_at_idx').on(table.createdAt),
]);

export const ticketAttachments = pgTable('ticket_attachments', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  storagePath: text('storage_path').notNull(),
  isPurged: boolean('is_purged').notNull().default(false),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('attachments_ticket_id_idx').on(table.ticketId),
  index('attachments_is_purged_idx').on(table.isPurged),
]);

export const mailboxesRelations = relations(mailboxes, ({ many }) => ({
  tickets: many(tickets),
}));

export const usersRelations = relations(users, ({ many }) => ({
  tickets: many(tickets),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  mailbox: one(mailboxes, {
    fields: [tickets.mailboxId],
    references: [mailboxes.id],
  }),
  assignee: one(users, {
    fields: [tickets.assigneeId],
    references: [users.id],
  }),
  replies: many(ticketReplies),
  attachments: many(ticketAttachments),
}));

export const ticketRepliesRelations = relations(ticketReplies, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketReplies.ticketId],
    references: [tickets.id],
  }),
}));

export const ticketAttachmentsRelations = relations(ticketAttachments, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketAttachments.ticketId],
    references: [tickets.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Mailbox = typeof mailboxes.$inferSelect;
export type NewMailbox = typeof mailboxes.$inferInsert;

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;

export type TicketReply = typeof ticketReplies.$inferSelect;
export type NewTicketReply = typeof ticketReplies.$inferInsert;

export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type NewTicketAttachment = typeof ticketAttachments.$inferInsert;

export const deletedTickets = pgTable('deleted_tickets', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ticketId: uuid('ticket_id'),
  messageId: text('message_id').notNull().unique(),
  subject: text('subject'),
  senderEmail: text('sender_email'),
  mailboxId: uuid('mailbox_id'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('deleted_tickets_message_id_idx').on(table.messageId),
  index('deleted_tickets_mailbox_id_idx').on(table.mailboxId),
]);

export type DeletedTicket = typeof deletedTickets.$inferSelect;
export type NewDeletedTicket = typeof deletedTickets.$inferInsert;

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  isAdmin: boolean('is_admin').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('roles_name_idx').on(table.name),
]);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;


