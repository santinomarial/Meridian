# Meridian

Meridian is a TypeScript end-to-end collaborative browser IDE for engineering teams. Engineers open a workspace in their browser, write and edit code through a Monaco-powered editor, and see each other's changes in real time — backed by Yjs CRDT convergence, Socket.IO sessions, Redis cross-instance fan-out, and PostgreSQL persistence.

---

## Features

- **Browser IDE workspace** — file explorer, editor tabs, activity bar, status bar, and a collapsible collaboration side panel
- **Monaco editor** — VS Code's editor engine with syntax highlighting, bracket pair colorization, and multi-language support
- **Project / document tree** — hierarchical file and folder structure per workspace, fetched from the backend on load
- **File operations** — create/rename/delete files and folders, open a local file from disk, and import/export a ZIP project — all synced to the backend; see [Workspace ZIP export](#workspace-zip-export)
- **Editor tabs** — multi-file editing with dirty-state tracking and Cmd+S / Ctrl+S save to backend
- **Command palette** — press Cmd+K / Ctrl+K to fuzzily search files and run real, permission-aware workspace commands — see [Command palette](#command-palette)
- **Integrated terminal** — opt-in (`ENABLE_TERMINAL=true`) PTY-backed terminal that materializes the workspace's files into a sandbox so you can run them (incl. "Run Active File"), with live sync as you edit — see [Integrated terminal](#integrated-terminal)
- **Version history & restore** — every meaningful save snapshots the file; preview any past version, diff it against the current file in a Monaco side-by-side editor, and restore it (editors/owners) — see [Version history & restore](#version-history--restore)
- **Live collaboration** — Socket.IO document rooms with Yjs CRDT merge; concurrent edits from multiple clients converge deterministically
- **Presence & chat** — real cursors/selections via the Yjs awareness protocol and a per-workspace live chat over Socket.IO
- **Share & invite** — backend-backed workspace invites: generate a shareable link or email an invite, accept it after sign-in to join with the assigned role
- **Authentication** — sign up, log in, log out, and a secure forgot/reset-password flow (argon2id hashing, JWT httpOnly cookies, per-session revocation)
- **Settings** — update your display name, switch theme (persisted), and trigger a password-reset email
- **Notifications** — an in-app feed of real session events (file saved, invite created); never fabricated
- **Yjs CRDT sync** — binary update protocol; the server maintains an authoritative Y.Doc per open document and performs sync step 1/2 handshakes with every joining client
- **Redis cross-instance fan-out** — Yjs updates, awareness, and chat are published to Redis and relayed to clients on other server instances; the document persistence sequence counter and terminal sandbox sync are also Redis-shared, so the backend scales horizontally (with sticky WebSocket sessions). See [docs/scaling.md](docs/scaling.md).
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

## Command palette

Press **Cmd+K** (macOS) / **Ctrl+K** (Windows/Linux) anywhere in the workspace to open the command palette. It is also reachable from **Go → Command Palette** in the header.

Behavior:

- Opens with Cmd+K / Ctrl+K (handled globally, so it works even when the editor or terminal is focused), closes with Esc.
- The search input autofocuses; **↑/↓** move through results, **Enter** runs the highlighted one, and clicking runs it.
- Results are grouped into **Files** and **Commands**. Typing filters both (files by name/path, commands by name/keywords); an empty query lists every available command. The empty state reads "No matching files or commands."

**File search** — searches the current workspace file tree by name and full path (case-insensitive, prefix/name matches ranked first). Selecting a file opens it in the editor. With no workspace loaded, no file results appear.

**Commands** — every entry maps to the same real action used elsewhere in the UI (no duplicated or placeholder logic): New File, New Folder, Save Active File, Run Active File, Open Version History, Toggle Terminal, Toggle Theme, Toggle Explorer, Toggle Collaboration Panel, Share Workspace, Open Settings, and Sign Out.

**Permission-aware** — commands reflect your role and workspace state rather than failing after the fact:

| Command | Availability |
|---|---|
| New File / New Folder / Save Active File | Disabled for **viewers** ("Requires editor access"); Save also needs an open file and a backend |
| Open Version History | Available to everyone, but needs an open, saved file ("Open a file first" / "Save the file first") |
| Toggle Terminal | Disabled with a reason when there is no workspace, the user is a viewer ("Requires editor access"), or the terminal is disabled on the server |
| Run Active File | Editor/owner only; disabled with a reason when there is no open file, the file type is not executable, or the terminal is disabled — see [Integrated terminal](#integrated-terminal) |
| Share Workspace | Shown **only to owners** |
| Toggle Theme / Explorer / Collaboration, Settings, Sign Out | Available to everyone |

Disabled commands show a short reason and cannot be executed (they are `aria-disabled` and skipped by keyboard navigation). Nothing in the palette is fake or a dead control — every visible entry either works or is honestly disabled for your role/state.

Accessibility: the palette is a `role="dialog"` with `aria-modal`, the input is a labelled `combobox` driving an `aria-activedescendant`, and results are a `listbox` of `option`s.

## Workspace ZIP export

The inverse of ZIP import: download the current workspace as a `.zip` via **File → Export Workspace as ZIP** or the command palette ("Export Workspace as ZIP"). The browser downloads `<workspace-name>.zip` (filename sanitized from the workspace name).

- **Endpoint** — `GET /workspaces/:workspaceId/export` returns `Content-Type: application/zip` with `Content-Disposition: attachment; filename="<safe-name>.zip"`.
- **Permissions** — any workspace member can export, including **viewers** (it is read-only). Non-members get a `404` (the workspace's existence isn't leaked). No role gating beyond membership.
- **Source of truth** — the archive is built **from the database**: every folder/file document with its latest saved content and preserved structure. Document paths are normalized to safe POSIX relative paths; absolute paths, `..` traversal, and control characters are rejected (such documents are skipped).
- **Included** — your workspace's files and folders (including empty folders), with the latest **saved** content.
- **Excluded** — terminal sandbox internals (they are never DB-backed, so they can't appear), and build artifacts such as `.meridian-build/`. No server files, env, or secrets are ever included.

**Limitations**

- Export reflects the **latest saved** DB content, not unsaved editor changes — save (Cmd/Ctrl+S) before exporting to include in-progress edits.
- The ZIP is assembled in memory (via `jszip`) before being sent. This is fine at Meridian's current scale (per-file content is small and capped); a very large workspace would warrant a streaming archiver.

## Integrated terminal

Meridian has a real, interactive PTY-backed terminal (xterm.js on the client, [`node-pty`](https://github.com/microsoft/node-pty) on the server) that operates on the current workspace's files.

**Enabling it** — the terminal is **off by default**. Set `ENABLE_TERMINAL=true` on the server to enable it. When disabled, `terminal:start`/`terminal:run-file` return a clear "Terminal feature is disabled on this server" message and the UI shows an honest disabled state — nothing is faked.

**Workspace sandbox model** — when the terminal starts, the workspace's DB-backed documents are *materialized* into a per-user, per-workspace sandbox directory (under the OS temp dir), preserving folder structure, and the shell's working directory is that sandbox root. A welcome banner names the sandbox path, and `pwd`/`ls` reflect the editor's files.

- **The database is the source of truth.** The sandbox is a disposable runtime *projection* of the workspace used only for terminal execution.
- While the terminal is open, editor operations are synced into the sandbox best-effort: **save** rewrites the file, **create** writes the file/folder, **rename** moves it, **delete** removes it, and **version restore** rewrites the restored content. A failed sync warns in the terminal ("Could not sync workspace file to terminal sandbox") and via a sync-status badge — it never corrupts the database.
- Sync is one-way (DB → sandbox). Files you create *inside* the terminal are not imported back into the workspace.

**Run Active File** — from the Command Palette (Cmd/Ctrl+K) or **File → Run Active File**. It saves the file if dirty, ensures the sandbox is synced, opens the terminal, and runs the file in it so the command and its real output appear naturally. Supported types:

| Extension | Command |
|---|---|
| `.py` | `python3 <file>` |
| `.js` | `node <file>` |
| `.ts` | `npx tsx <file>` (honest error if `tsx` isn't installed) |
| `.sh` | `bash <file>` |

Other types (`.json`, `.md`, `.txt`, images/binaries) are not executable and the action is disabled with the reason "This file type is not executable". Run is editor/owner only (viewers see "Requires editor access"); it is also disabled with a reason when no file is open or the terminal is disabled.

**Security** — secrets (`DATABASE_URL`, `JWT_SECRET`, …) are never put in the shell environment; `HOME` points at the sandbox; all materialization/sync paths are validated to stay inside the sandbox root (absolute paths, `..` traversal, control characters, and symlinked-ancestor escapes are rejected); run-file validates auth, workspace membership, editor/owner role, that the document belongs to the workspace, and a safe (single-quoted) path. Start/input/run are all gated by `ENABLE_TERMINAL` and by role.

**Known limitations**

- The sandbox is a projection of DB-backed workspace files; it is **not** the database.
- Runtime availability (`python3`, `node`, `tsx`, `bash`) depends on what is installed on the **server machine** — a missing runtime surfaces the shell's real error, not a fake message.
- This is **not** container/Docker isolation. The shell runs as the server's OS user with that user's filesystem permissions; sandboxing is limited to working directory, `HOME`, environment scrubbing, and sandbox-confined file sync. Do not run the server as root, and run it as an unprivileged user in untrusted multi-tenant settings.
- The database remains the source of truth; the sandbox can be deleted at any time and is rebuilt on the next terminal start.

## Version history & restore

Every file keeps a real, server-backed history of saved versions (`DocumentVersion` model). There are no local-only or fabricated entries — every item in the list is a row in the database.

**When versions are created**

- A version is recorded **only when a save meaningfully changes the content** — i.e. a `PATCH /documents/:id` whose `content` differs from what is currently persisted. Identical saves and metadata-only updates (rename/move) never create a version, so the history has no duplicates.
- `versionNumber` increments per document; the first meaningful save becomes version 1.
- The document update and the version insert happen in a single transaction, so they either both commit or both roll back.

**Endpoints**

- `GET /documents/:documentId/versions` — lightweight list (id, number, timestamp, author, message, content length), newest first.
- `GET /documents/:documentId/versions/:versionId` — a single version with its full content.
- `POST /documents/:documentId/versions/:versionId/restore` — restore the document to that version's content.

**Restore behavior**

- Rewrites the document content and records a **new** version capturing the restored content with the message `Restored from version X` (so a restore is itself an undoable point in history).
- The new content is broadcast to everyone currently editing the file, and connected clients update live.

**Permissions**

- **Viewers** can list, preview, and diff versions, but **cannot restore** — the restore control is replaced with "Viewer access cannot restore versions."
- **Editors and owners** can restore.
- **Non-members** receive `404` for every version endpoint (ids are not enumerable across workspaces), consistent with the rest of the document API.

**UI**

- Open via **File → Version History** (enabled only for a file that exists on the backend). The dialog shows a loading state, an empty state when no versions exist, and the version list with number, timestamp, and author.
- Select a version to preview it read-only, or toggle **Compare with current** to see a Monaco side-by-side diff (left: the selected version, right: the current file).
- Restoring asks for confirmation, calls the backend, shows a "Restored version X" notification, marks the tab clean, and refreshes the list.

**Collaboration / Yjs note**

Live editing is driven by a Yjs CRDT, while versions store plain text. Restore reconciles both:

- If the document is **open** (a live `Y.Doc` exists), the server replaces the canonical Y.Text inside a Yjs transaction and broadcasts the resulting incremental update — connected editors converge cleanly with no reload, no rebind, and no divergent CRDT items. The CRDT history is then collapsed into a single snapshot of the restored state.
- If the document is **not open**, the Yjs history is dropped so the next collaborative open re-seeds the `Y.Doc` from the restored content column.
- A `document:restored` event is emitted so clients reconcile their save/dirty indicators.

The persisted Yjs history is reset through the document persistence layer, whose sequence counter is Redis-shared across instances (with an in-memory fallback when Redis is down). See [docs/scaling.md](docs/scaling.md) for the cross-instance design.

## Sessions & login

Sessions are httpOnly-cookie JWTs backed by a `Session` database row (revocable per session). Expired sessions are a normal state and are handled cleanly end to end:

- **Lifetime** — sessions last `JWT_EXPIRES_IN` (default **7 days**). The cookie `Max-Age`, JWT `exp`, and `Session.expiresAt` always agree.
- **Expired session on load** — `GET /auth/me` returns 401 (never 500) and clears the stale cookie; the app treats you as logged out and shows the login screen. No crash, no misleading "backend unavailable" state.
- **Logging back in** — login ignores any stale cookie and always sets a fresh one, so logging in after weeks away just works.
- **Clear errors** — wrong credentials show "Invalid email or password."; a rate-limited login shows "Too many login attempts. Please wait and try again."; an unreachable backend shows "Unable to connect to Meridian. Please check that the server is running." The auth flows never show a vague "Something went wrong" for expected states.
- **Demo mode** is only entered when the backend is actually unreachable — never for a merely expired session.

**Local dev troubleshooting**

| Symptom | Cause / fix |
|---|---|
| Login page appears after time away | Session expired (normal) — just log in again |
| "Unable to connect to Meridian…" on login | Backend not running — `cd server && npm run start:dev` (and `npm run infra:up` for Postgres/Redis) |
| Stale cookie weirdness | The server clears dead cookies automatically on the first 401; you can also delete the `auth_token` cookie in DevTools → Application → Cookies |
| Fresh local DB | `cd server && npm run db:migrate && npm run db:seed` (your old accounts/sessions are gone — sign up again) |

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
| `JWT_EXPIRES_IN` | Session lifetime (default `7d`) — see [Sessions & login](#sessions--login) |
| `CLIENT_ORIGIN` | Frontend origin, used to build invite/reset URLs and for CORS |
| `RESEND_API_KEY` | Optional — enables real email delivery via Resend |
| `MAIL_FROM` | From-address for outgoing email |
| `E2E_TEST` | When `true`, raises rate limits and enables test-only helper endpoints (see below) |

The client reads `VITE_API_URL` (defaults to `http://localhost:3000`).

## Testing

Meridian has four test layers:

| Layer | Where | Runner | Needs a backend? |
|---|---|---|---|
| **Server unit** | `server/src/**/*.spec.ts` | Jest (Prisma mocked) | No |
| **Server HTTP integration** | `server/test/**/*.e2e-spec.ts` | Jest + supertest | Yes — real Postgres + Redis |
| **Client unit** | `client/src/**/*.test.ts` | Vitest | No |
| **End-to-end** | `client/e2e/**/*.spec.ts` | Playwright | Yes — full stack |

```bash
# Server unit tests (fast, no database)
cd server && npm test

# Server HTTP integration tests — exercise the real request pipeline
# (ValidationPipe, JwtAuthGuard, throttler, exception filter, real Prisma)
# via supertest. Run against a migrated database (Postgres + Redis up):
cd server && npm run test:integration

# Client unit tests (pure logic) + type-check + build
cd client && npm test && npx tsc -b && npm run build

# End-to-end (Playwright)
cd client && npx playwright install chromium   # first run only
# Start the backend with test helpers + relaxed limits:
cd server && E2E_TEST=true npm run start:dev
# Then run the suite (Playwright starts the Vite dev server itself):
cd client && MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e
```

The HTTP integration tests boot the real `AppModule` (no listening port — supertest drives `app.getHttpServer()`), create throwaway users under an `int-*` email prefix, and clean only those rows up afterward, so they are safe to run against a shared dev database. E2E tests that require a backend skip automatically when none is reachable; the remaining demo/offline tests run against the frontend alone.

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on pull requests:

- **server** — `prisma generate` → `npm run build` → `npm test` (unit tests mock Prisma, so no database is needed).
- **server-integration** — spins up Postgres + Redis, `prisma migrate deploy`, then `npm run test:integration` (supertest against the booted app; `E2E_TEST` deliberately unset so the real throttler runs).
- **client** — `tsc -b` (typecheck) → `npm test` (Vitest unit tests) → `npm run build`.
- **e2e** — spins up Postgres + Redis services, applies migrations, starts the backend with `E2E_TEST=true ENABLE_TERMINAL=true`, then runs the full Playwright suite (Playwright launches the Vite dev server itself). The Playwright report is uploaded as an artifact on failure.
- **lint** — `npm run lint` (ESLint); blocking.

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
- **AI assistant** — no model is wired up, so the AI sidebar was removed.
- **GitHub OAuth** — sign-in is email/password only.
- **Changing your login email** — the settings panel shows email read-only.

## Architecture

See **[docs/architecture.md](docs/architecture.md)** for the full diagram set: system context, container layout, backend components, realtime editing sequence, cross-instance Redis scaling, Yjs persistence and recovery, and the complete data model. See **[docs/scaling.md](docs/scaling.md)** for the horizontal-scaling design: what is shared across replicas (Redis fan-out, the document sequence counter, terminal sandbox sync), the sticky-session requirement, and known limitations.
