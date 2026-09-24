# HelpDeskSoft

A shared staff helpdesk with ticket queues, assignments, IMAP and Microsoft Graph ingestion, queued replies, and attachment retention. The backend uses Fastify, TypeScript, PostgreSQL and Drizzle; the browser uses vanilla JavaScript.

## Local development

Use Node 24 and PostgreSQL 16. Copy `.env.example` to `.env`, generate separate JWT/encryption keys, and set database URLs for a development database. The encryption key must be exactly 64 hexadecimal characters. Keep it stable across restarts.

```sh
npm ci
npm run db:migrate
npm run admin:bootstrap -- admin@example.com
npm run dev
```

Open `http://localhost:3000`. The bootstrap command prints a one-hour, single-use invitation. Enter it with the administrator email and a new password. There is no default administrator password and knowing an email address does not authorize setup. Existing initialized administrators create/reset staff accounts in the admin UI and privately deliver the resulting invitation link.

On Windows PowerShell use `npm.cmd` if script execution policy blocks `npm`. Database creation is an explicit operator task; application startup never runs migrations.

## Access and workflow

- All API ticket and staff operations require an active, initialized staff account. Role changes, disabling, password reset, and logout revoke existing sessions.
- This is a **shared staff queue**. All staff can read and work on every ticket. Departments control assignment routing; they are not confidentiality boundaries. A role's `isAdmin` flag controls administration. Department isolation/SSO/MFA require a separately specified policy.
- Mailboxes can route to one or more departments. With an explicit routing policy and no active matching staff, tickets remain unassigned. Manual assignment must obey that policy. Assignment decisions are serialized in PostgreSQL; ticket edits use a version to detect conflicts.
- Inbound follow-ups use Message-ID/References and the originating mailbox and sender to join a conversation. Customer follow-ups reopen tickets as WAITING. Sender headers alone are not identity verification; rely on provider filtering and use a verified customer portal if stronger identity is required.
- Replies are saved with an outbox job before delivery. The UI distinguishes queued, sending, sent, failed, and unconfirmed delivery. Transport ambiguity is never automatically retried. Staff must check Sent Items before explicitly retrying an unconfirmed send. Exactly-once SMTP delivery is not promised.
- Outgoing replies use the ticket's mailbox. Disabling a mailbox prevents new ingestion and dispatch; a transport operation already underway may finish. SMTP configuration is read for each send.
- Defaults: 20 attachments, 10 MiB per file, 25 MiB total. Uploads stream to durable storage; inbound MIME parsing is bounded to 25 MiB. Resolved-ticket attachments expire after 24 hours from resolution. Reopening clears the resolution timestamp. Failed file deletions remain retryable; old unclaimed uploads/orphans are reconciled.
- Notifications are a per-user, per-tab **local activity list**, not a durable event subscription. Lists poll every 30 seconds while visible; an open conversation polls every 7 seconds. Drafts are kept in memory per ticket and are lost when the tab closes.

## Verification

```sh
npm run lint
npm test
npm run test:postgres:local
npm run test:browser
npm audit --audit-level=moderate
```

`lint` checks backend TypeScript, the typed browser API boundary, JavaScript syntax, and the inline-handler policy. Fast tests use pg-mem; it does not reproduce PostgreSQL transactions. `test:postgres:local` starts PostgreSQL 16 on a random loopback port in a new `scratch/postgres-*` directory, runs migration/concurrency/rollback tests, then stops it. It never uses `DATABASE_URL`. Alternatively set `TEST_DATABASE_URL` to a disposable database and run `npm run test:postgres`; each run creates and drops isolated test schemas.

Browser tests use local Edge on Windows and Playwright Chromium elsewhere (`npx playwright install chromium`). They run a separate in-memory test server with fake accounts, no workers and no outgoing mail. Tests cover pagination past 100 tickets, malicious attachment names, drafts, navigation during upload, keyboard dialogs, small screens, languages, and expired sessions.

The embedded PostgreSQL package omits backup client tools, so its backup test is explicitly skipped. For the complete local database suite, set `PG_TEST_BIN` to a full PostgreSQL installation's `bin` directory and run `npm run test:postgres:local`; this also creates a new isolated cluster using that installation's server. Never mix newer dump tools with an older restore server. CI uses matching PostgreSQL 16 clients.

CI adds a PostgreSQL service, dependency audit, a restricted container smoke test, and a backup/restore drill. Provider contract tests mock the network. A real test-tenant exchange is still required before enabling production mailboxes.

See [operations and upgrade guide](docs/OPERATIONS.md) before deployment and [remediation status](REMEDIATION_STATUS.md) for the review-to-change mapping. [PROJECT_REVIEW.md](PROJECT_REVIEW.md) is the original pre-change audit.
