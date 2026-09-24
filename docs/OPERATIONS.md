# Deployment, upgrade and recovery

## New Compose installation

1. Copy `.env.example`, generate independent secrets, and set the three database passwords. Use random hex passwords so database URLs need no escaping. Keep `.env` out of source control and restrict its filesystem permissions. Production refuses placeholder JWT keys and invalid encryption keys.
2. Set `CORS_ORIGIN` to the application's exact origin. For public deployment set `HELPDESK_DOMAIN` and use `docker compose --profile tls up -d --build`. Caddy terminates TLS; HTTP backend access is bound to host loopback. Without TLS use `docker compose up -d --build` for a local-only installation.
3. The first database initialization creates separate owner/migration and restricted application roles. The one-shot migration service must succeed before the application starts. The application runs as UID 1000, with a read-only root filesystem, dropped capabilities, resource limits, and a named attachment volume owned by UID 1000.
4. Run `docker compose exec backend node dist/backend/src/modules/auth/bootstrap.js admin@example.com`. Deliver the printed invitation privately. Configure/test mailboxes in the admin UI.

The optional proxy has the fixed IP `172.30.50.10`, the only proxy trusted by the default Compose configuration. Choose a nonconflicting `HELPDESK_SUBNET`/`HELPDESK_PROXY_IP` and matching `TRUSTED_PROXIES` if that subnet is already used. Do not trust an entire public network. An upstream proxy must replace client forwarding headers. Request logging excludes query strings and authorization headers.

Compose forwards retention, poll interval, message-size, logging and encryption settings. Credentials for mailboxes are encrypted using AES-256-GCM and a key separate from the database. The key belongs in a protected deployment secret store; inject it as `SECRET_ENCRYPTION_KEY`. Back it up separately from the database. Losing it makes mailbox credentials unrecoverable.

## Existing installation upgrade

Do not replace an existing deployment's volumes or credentials by blindly running the new Compose file. The prior configuration used a superuser and a bind-mounted `./storage`; the new configuration uses a restricted account and named storage.

1. Stop application workers and take a coordinated backup of PostgreSQL, attachments and the old deployment configuration. Keep the encryption key separately. Rehearse on an isolated restored copy first.
2. Keep the same Compose project name and existing PostgreSQL volume. The PostgreSQL init script only runs for an empty volume. For an existing database, an operator must create `helpdesk_owner` and `helpdesk_app`, transfer ownership of the application schema/tables/sequences from the legacy owner, and establish the grants/default privileges in `ops/init-db.sh`. Do not rerun that initialization script against a nonempty database.
3. Run migration with the existing schema owner's credentials (or after ownership transfer, with `helpdesk_owner`). Supply the new stable encryption key. The version ledger and transaction advisory lock make repeated/concurrent runs safe. Migration 1 imports the old schema; migration 2 adds invariants, invitations, outbox, cursors, timestamps and encrypted credentials. No account is seeded. Unknown existing role names are preserved in the catalog. Invalid legacy status/provider values or duplicate reply Message-IDs make the migration fail and roll back; inspect and repair those records before retrying rather than deleting history automatically.
4. Copy the old attachment directory into the new named volume, retaining the `/app/storage` internal path, then set ownership to UID/GID 1000. Alternatively retain the existing bind mount with correct ownership. Attachment records contain absolute paths; if the internal root changes, migrate those paths under backup before startup. Storage initialization fails rather than silently selecting another directory.
5. Start the application with the restricted runtime URL. Existing JWTs are rejected because they lack the new purpose/session claims. Existing password hashes remain valid. Uninitialized accounts require fresh admin-issued invitations. Bootstrap is available only if no initialized active administrator exists.
6. Verify `/health`, admin operations, login, one attachment download, and a provider round trip in a designated test mailbox before resuming normal mail flow. Never copy production provider credentials into a running test environment.

Migrations are forward-only and owned by `backend/src/db/migrate.ts`; Drizzle is used for queries, not a second migration system. Do not edit applied migration versions. Future changes need a new ledger version. Rollback means restoring a coordinated database/files snapshot and the matching application release; older application code must not operate on encrypted credentials.

## Monitoring and incident handling

`GET /health` checks database connectivity and returns HTTP 503 on failure. Container health checks call it. `GET /api/admin/operations` requires an administrator bearer token and reports outbox states, mailbox errors/staleness, free disk space and process memory/uptime. Fetch with an Authorization header, never put tokens in URLs. Central logs carry job/ticket identifiers; do not enable logging of request bodies or mailbox credentials.

Configure an external monitor to alert on readiness failures, active mailboxes stale for more than five minutes, any sync error, any failed/unconfirmed outbox jobs, pending jobs older than the expected dispatch window, and storage below your reserve threshold (suggested initial threshold: 10% or 1 GiB). The endpoint supplies diagnostic data; alert delivery and on-call ownership are deployment responsibilities. Review mailboxes and outbox queues after restart. A sending job abandoned for ten minutes becomes unconfirmed and needs human reconciliation.

Oversized/malformed inbound mail stops advancement of that mailbox checkpoint and raises a sync error. An operator must move/quarantine the offending message in the provider inbox, then resync. Files must not be silently discarded. Graph uses delta checkpoints and immutable IDs, IMAP uses UIDVALIDITY/UIDs, and both use durable deduplication. Multiple replicas require the same database, encryption key, and shared attachment storage. Leases and advisory locks coordinate jobs; global assignment/cleanup locks intentionally favor correctness over high throughput. Benchmark expected load before increasing replicas.

Microsoft Graph requires application `Mail.ReadWrite` and `Mail.Send` access scoped to approved mailboxes by the tenant administrator. A connection test verifies inbox access, not every sending permission. Test plain text, follow-up threading, small/large attachments, throttling, and credential changes in a test tenant. IMAP tests must include old/read messages and reconnects; SMTP tests must include TLS, rejection and disconnect during DATA.

Provider implementation references: [Graph delta tracking](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0), [immutable IDs and delayed Sent Items availability](https://learn.microsoft.com/en-us/graph/outlook-immutable-id), and [large attachment upload sessions](https://learn.microsoft.com/en-us/graph/outlook-large-attachments). Sent-message lookups retry briefly without resending the message.

## Backup and restore

The scripts require a POSIX shell, Docker Compose and sha256sum; use Linux/WSL for deployment operations. Run `sh ops/backup.sh backups/2026-09-24` from the repository root. It briefly stops the backend, captures a PostgreSQL custom-format dump and attachment archive, records checksums, and restarts the backend. Schedule nightly backups as an initial target (RPO at most 24 hours); adjust to your actual service requirements. Encrypt backup storage, limit access, and keep off-host copies. Retain the separate encryption key and deployment settings.

Rehearse with `COMPOSE_PROJECT_NAME=helpdesk-restore sh ops/restore.sh backups/2026-09-24`. The script uses a separate subnet and refuses to restore over a nonempty database or storage volume. It starts only the database/migrator, so restored mail jobs are not sent. Before starting the restored backend, disable mailboxes and hold pending outbox jobs in that isolated database. Check migration versions, row counts, login and attachment bytes. Establish a measured RTO by timing the drill; no recovery-time guarantee is assumed. CI exercises both archives against a fresh Compose project.

The provided backup is coordinated only for this Compose application's worker. Stop every replica and external writer for a production snapshot. A live external PostgreSQL or storage system may provide its own consistent backup mechanism; document that contract instead of running these single-instance scripts unchanged.

## Key rotation

JWT rotation invalidates sessions. Mailbox encryption-key rotation requires a stopped-worker maintenance operation that decrypts every mailbox secret with the old key and re-encrypts it with the new key in a transaction; simply changing the environment variable will break credential reads. Keep the old key with its matching backup until retention ends. Rotation is an operator-controlled change; keys are never generated or rotated automatically at startup.
