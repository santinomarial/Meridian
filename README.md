# Meridian

Meridian is a TypeScript end-to-end collaborative browser IDE for engineering teams. Engineers open a workspace in their browser, write and edit code through a Monaco-powered editor, and see each other's changes in real time — backed by Yjs CRDT convergence, Socket.IO sessions, Redis cross-instance fan-out, and PostgreSQL persistence.

---

## Features

- **Browser IDE workspace** — file explorer, editor tabs, activity bar, status bar, and a collapsible collaboration side panel
- **Monaco editor** — VS Code's editor engine with syntax highlighting, bracket pair colorization, and multi-language support
- **Project / document tree** — hierarchical file and folder structure per workspace, fetched from the backend on load
- **File operations** — create/rename/delete files and folders, open a local file from disk, and import a ZIP project — all synced to the backend
- **Editor tabs** — multi-file editing with dirty-state tracking and Cmd+S / Ctrl+S save to backend
- **Live collaboration** — Socket.IO document rooms with Yjs CRDT merge; concurrent edits from multiple clients converge deterministically
- **Presence & chat** — real cursors/selections via the Yjs awareness protocol and a per-workspace live chat over Socket.IO
- **Share & invite** — backend-backed workspace invites: generate a shareable link or email an invite, accept it after sign-in to join with the assigned role
- **Authentication** — sign up, log in, log out, and a secure forgot/reset-password flow (argon2id hashing, JWT httpOnly cookies, per-session revocation)
- **Settings** — update your display name, switch theme (persisted), and trigger a password-reset email
- **Notifications** — an in-app feed of real session events (file saved, invite created); never fabricated
- **Yjs CRDT sync** — binary update protocol; the server maintains an authoritative Y.Doc per open document and performs sync step 1/2 handshakes with every joining client
- **Redis cross-instance fan-out** — Yjs updates and awareness states are published to Redis and relayed to clients on other server instances
- **PostgreSQL persistence** — users, workspaces, documents, invites, and Yjs update logs persisted durably via Prisma
- **Snapshot compaction** — every N Yjs updates the in-memory Y.Doc state is saved as a Snapshot row and preceding update rows are deleted in a single transaction, bounding storage growth
- **Frontend resilience** — when the backend is unavailable the frontend falls back to a clearly-labelled local demo workspace; no crash, no empty screen, and demo data never appears as if it were real

---

## Monorepo layout

```text
Meridian/
├── client/     # React + TypeScript + Vite frontend
├── server/     # NestJS + TypeScript backend
└── docs/       # Architecture documentation
```

---

## Tech stack

### Frontend

| Library / Tool | Role |
|---|---|
| React 18 | UI component framework |
| TypeScript | Static typing end-to-end |
| Vite | Build tool and dev server |
| Tailwind CSS | Utility-first styling system |
| Zustand | Global workspace state management |
| Monaco Editor | VS Code editor engine (`@monaco-editor/react`) |
| React Router | Client-side routing |
| Yjs + y-monaco | CRDT collaborative editing bound to Monaco |
| socket.io-client | WebSocket transport |

### Backend

| Library / Tool | Role |
|---|---|
| NestJS | Server framework — modules, DI, decorators |
| TypeScript | Static typing end-to-end |
| PostgreSQL | Primary durable datastore |
| Prisma | ORM, type-safe queries, schema migrations |
| Socket.IO | WebSocket transport for realtime events |
| Yjs + y-protocols | Authoritative CRDT document state on the server |
| Redis (ioredis) | Cross-instance pub/sub fan-out |
| JWT (`@nestjs/jwt`) | Stateless auth tokens |
| argon2id | Password hashing (argon2id variant) |
| Pino (`nestjs-pino`) | Structured JSON logging |
| Swagger | Auto-generated OpenAPI documentation |

---

## Local development

### Client

```bash
cd client
npm install
npm run dev       # Dev server → http://localhost:5173
npm run build     # Production build
```

### Server

```bash
cd server
npm install
cp .env.example .env        # Set JWT_SECRET; review other values
npm run infra:up            # Start PostgreSQL + Redis via Docker Compose
npm run db:migrate          # Apply Prisma schema migrations
npm run db:seed             # Seed demo workspace and user
npm run start:dev           # Dev server with file watch → http://localhost:3000
npm test                    # Run unit test suite
npm run build               # Compile TypeScript
```

---

## Local URLs

| URL | Purpose |
|-----|---------|
| `http://localhost:5173` | Frontend workspace |
| `http://localhost:3000/health` | Backend liveness probe |
| `http://localhost:3000/ready` | Backend readiness probe (Postgres + Redis) |
| `http://localhost:3000/docs` | Swagger / OpenAPI explorer |
| `http://localhost:5555` | Prisma Studio (`npm run db:studio` in `server/`) |

---

## Sharing & invites

Invites are real and backed by the database (`Invite` model):

- `POST /workspaces/:workspaceId/invites` — create an invite (members only). Returns a shareable `inviteUrl` containing a high-entropy, unguessable token. An optional `email` triggers an invite email.
- `GET /invites/:token` — public invite details (workspace name, role, inviter, expiry) used to render the `/invite/:token` page before sign-in.
- `POST /invites/:token/accept` — accept as the authenticated user; adds a `WorkspaceMember` with the invite's role.

Design notes:

- Tokens are random 24-byte `base64url` strings stored uniquely; they are unguessable, so they are not additionally hashed at rest.
- Invites **expire** after 7 days (`410 Gone` after that).
- Invites are **safely reusable**: accepting is idempotent, so a single link can onboard a whole team. The first acceptance stamps `acceptedAt`.
- The `/invite/:token` page shows a valid/expired/invalid state, and when unauthenticated it sends the user to sign in with a `?redirect=` back to the invite so acceptance completes in one flow.

## Password reset & email

- `POST /auth/forgot-password` always returns the same generic message and never reveals whether an account exists.
- `POST /auth/reset-password` consumes a single-use token (30-minute TTL).
- Email delivery uses `MailService`. If `RESEND_API_KEY` is set, reset and invite emails are sent via Resend. In **development without a provider**, the action URL is logged to the console so you can test locally. In **production without a provider**, the send fails internally (logged/monitored) rather than pretending an email was sent.

## Environment variables (server)

Set these in `server/.env` (see `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Secret for signing session JWTs (required) |
| `CLIENT_ORIGIN` | Frontend origin, used to build invite/reset URLs and for CORS |
| `RESEND_API_KEY` | Optional — enables real email delivery via Resend |
| `MAIL_FROM` | From-address for outgoing email |
| `E2E_TEST` | When `true`, raises rate limits and enables test-only helper endpoints (see below) |

The client reads `VITE_API_URL` (defaults to `http://localhost:3000`).

## Testing

```bash
# Server unit tests
cd server && npm test

# Client type-check and build
cd client && npx tsc --noEmit && npm run build

# End-to-end (Playwright)
cd client && npx playwright install chromium   # first run only
# Start the backend with test helpers + relaxed limits:
cd server && E2E_TEST=true npm run start:dev
# Then run the suite (Playwright starts the Vite dev server itself):
cd client && MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e
```

Tests that require a backend skip automatically when none is reachable; the remaining demo/offline tests run against the frontend alone.

### `E2E_TEST=true` behavior

This flag is **only** for automated tests and changes nothing in normal dev/prod:

- Rate limiters are raised so Playwright never trips `429`s.
- WebSocket message limits are raised so rapid Yjs updates aren't dropped.
- Test-only endpoints become reachable (they return `404` otherwise):
  - `GET /auth/e2e/password-reset-token?email=` — returns a raw reset token without sending email.
  - `POST /e2e/cleanup` — deletes throwaway accounts (default email prefix `e2e-`) and their owned workspaces, keeping the test DB tidy across runs.

## What is intentionally not implemented

These were deliberately left out (and are therefore hidden from the UI rather than faked):

- **Git integration** — there is no branch selector or source-control panel; Meridian persists documents, not Git history.
- **Integrated terminal / build / debug console** — no PTY backend, so the bottom terminal/output/debug panel was removed.
- **AI assistant** — no model is wired up, so the AI sidebar was removed.
- **GitHub OAuth** — sign-in is email/password only.
- **Changing your login email** — the settings panel shows email read-only.

## Architecture

See **[docs/architecture.md](docs/architecture.md)** for the full diagram set: system context, container layout, backend components, realtime editing sequence, cross-instance Redis scaling, Yjs persistence and recovery, and the complete data model.
