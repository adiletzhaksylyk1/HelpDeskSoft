# Helpdesk Service

Production-ready Helpdesk / Service Desk backend providing automated inbound email ticket conversion, concurrency-safe workload assignment, REST API management, and threaded outbound SMTP replies.

## Architecture

- **Runtime**: Node.js 24 with TypeScript.
- **Web Framework**: Fastify with Zod schema validation and Pino structured logging.
- **Database**: PostgreSQL with Drizzle ORM.
- **Email Processing**: ImapFlow and MailParser for inbound mail ingestion, Nodemailer for threaded SMTP replies.
- **Deployment**: Docker Compose packaging backend and PostgreSQL with persistent data volume.

## Quick Start

### 1. Environment Setup

Copy example environment variables:

```bash
cp .env.example .env
```

### 2. Run with Docker Compose

Start PostgreSQL and the backend service:

```bash
make docker-up
```

Stop services:

```bash
make docker-down
```

### 3. Local Development

Install dependencies and run database migrations:

```bash
npm install
npm run db:migrate
npm run dev
```

Run test suite:

```bash
make test
```

Build production bundle:

```bash
make build
```

## Makefile Targets

- `make lint` - Runs TypeScript type checking
- `make test` - Executes Vitest in-memory test suite
- `make build` - Compiles TypeScript to `dist`
- `make run` - Launches production server from `dist`
- `make version` - Prints current package version
- `make docker-up` - Builds and runs Docker containers
- `make docker-down` - Stops Docker containers

## REST API Endpoints

### Tickets

- `GET /api/tickets` - List tickets with filtering (`status`, `priority`, `assignee`) and pagination (`page`, `limit`)
- `POST /api/tickets` - Create new ticket with automatic employee workload assignment
- `GET /api/tickets/:id` - Get ticket details including assignee and replies
- `PATCH /api/tickets/:id` - Update ticket status (`WAITING`, `IN_PROGRESS`, `RESOLVED`) and priority (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
- `PATCH /api/tickets/:id/assign` - Reassign ticket to an employee or trigger automatic assignment
- `GET /api/tickets/:id/replies` - Retrieve chronological replies for a ticket
- `POST /api/tickets/:id/replies` - Add reply; automatically dispatches threaded email via SMTP when submitted by an employee

### Users

- `GET /api/users` - List employees with optional `is_active` query filter
- `POST /api/users` - Create employee user

### Health

- `GET /health` - Service health status
