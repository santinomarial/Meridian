# Meridian

Meridian is a full-stack collaborative browser IDE. It combines a React and
Monaco client with a NestJS API, Yjs-based realtime editing, PostgreSQL
persistence, and optional Redis-backed cross-process coordination.

The repository is organized as two independently managed Node.js applications.
There is no root package manifest; run package commands from `client/` or
`server/` as shown below.

## Capabilities

- Monaco-based editing with a hierarchical file tree, tabs, command palette,
  keyboard shortcuts, and language-aware editor behavior.
- Concurrent document editing through Yjs, including cursor and selection
  presence, workspace chat, reconnect synchronization, and asynchronously
  persisted update logs.
- Workspace ownership and `OWNER`, `EDITOR`, and `VIEWER` membership roles,
  with authorization enforced by the API and realtime gateways.
- File and folder creation, rename, deletion, local-file import, ZIP import and
  export, saved version history, diffs, and version restore.
- Email and password authentication with argon2id hashes, revocable JWT-backed
  sessions, password reset, and expiring workspace invitations.
- An optional PTY terminal that projects saved workspace files into a temporary
  server-side directory and can run supported source files.
- Structured logging, HTTP request identifiers, HTTP throttling,
  collaboration-event limits, health probes, readiness checks, and generated
  OpenAPI documentation.
- A clearly labeled, non-persistent local demonstration workspace when backend
  workspace loading fails; authentication failures return to sign-in instead.

## Architecture

| Component | Implementation | Responsibility |
|---|---|---|
| Web client | React 18, TypeScript, Vite, Monaco, Zustand | Workspace UI, editor state, REST calls, and realtime bindings |
| API server | NestJS 11, TypeScript, Socket.IO | Authentication, authorization, workspace and document APIs, realtime rooms, and terminal sessions |
| Primary datastore | PostgreSQL 16, Prisma | Users, sessions, memberships, documents, invitations, versions, Yjs updates, and snapshots |
| Coordination | Redis 7, ioredis | Cross-process realtime fan-out, authorization invalidation, accelerated sequence allocation, chat, and terminal projection events |

PostgreSQL stores all durable application data, but file content has two
distinct representations. `Document.content` is the explicitly saved value
used by the REST API, versions, exports, and terminal materialization. Each open
collaborative document also has an in-memory `Y.Doc`; its incremental updates
are queued for asynchronous PostgreSQL persistence and periodically compacted
into snapshots. Live Yjs edits do not update `Document.content` until the
client performs an explicit Save. A database write failure is logged, and an
accepted update can be lost once no client or server memory retains it.

One API process is the recommended deployment topology for collaborative state.
Redis is optional in that topology and enables cross-process event fan-out when
present. PostgreSQL transaction-scoped advisory locks serialize durable document
updates, compaction, and history reset across API processes; Redis accelerates
sequence allocation but is not the durability boundary. Multi-replica operation
is still not a production guarantee because Redis Pub/Sub has no replay and a
version restore does not invalidate live Yjs state on other replicas. See
[Horizontal scaling](docs/scaling.md).

Detailed diagrams and runtime sequences are available in
[Architecture](docs/architecture.md). Multi-instance requirements and failure
behavior are documented in [Horizontal scaling](docs/scaling.md).

## Repository layout

| Path | Contents |
|---|---|
| [`client/`](client/) | React application, unit tests, and Playwright end-to-end tests |
| [`server/`](server/) | NestJS application, Prisma schema and migrations, unit tests, and HTTP integration tests |
| [`docs/`](docs/) | Architecture and scaling documentation |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Build, lint, unit, integration, and end-to-end CI jobs |

## Prerequisites

- Node.js 22.12 or later and npm, satisfying the Vite 8 runtime requirement.
- Docker with Docker Compose for the provided PostgreSQL and Redis services.
- A native C/C++ build toolchain and Python when `node-pty` must compile from
  source on the host platform.

## Local development

### 1. Start the backend

From the repository root:

```bash
cd server
npm ci
cp .env.example .env
npm run infra:up
docker compose exec postgres pg_isready -U postgres
docker compose exec redis redis-cli ping
npm run db:migrate
npm run db:seed
npm run start:dev
```

The Compose file does not define container health checks. Wait for
`pg_isready` to report that PostgreSQL accepts connections and for Redis to
return `PONG` before applying migrations or starting the server.

Before using the application beyond local development, replace the placeholder
`JWT_SECRET` in `server/.env` with a unique random value of at least 16
characters. `openssl rand -hex 32` produces a suitable development secret.

The seed step is optional. It creates one demonstration workspace with the
following accounts:

| Account | Workspace role |
|---|---|
| `alice@meridian.dev` | Owner |
| `bob@meridian.dev` | Editor |
| `carol@meridian.dev` | Editor |
| `dave@meridian.dev` | Viewer |

The default development password is `Meridian1!`. Set
`MERIDIAN_SEED_PASSWORD` before `npm run db:seed` to override it. Seeding with
`NODE_ENV=production` requires that override, but the seed still creates fixed
demonstration identities and should not be run against a production database.

### 2. Start the client

In a second terminal:

```bash
cd client
npm ci
npm run dev
```

The development client uses `http://localhost:3000` for both the REST API and
Socket.IO when no Vite environment override is present.

### 3. Verify the stack

| URL | Purpose |
|---|---|
| `http://localhost:5173` | Web client |
| `http://localhost:3000/health` | Process liveness |
| `http://localhost:3000/ready` | PostgreSQL readiness and Redis status |
| `http://localhost:3000/docs` | Swagger UI |
| `http://localhost:3000/docs-json` | Raw OpenAPI document |
| `http://localhost:5555` | Prisma Studio after `npm run db:studio` in `server/` |

Stop the local infrastructure with `npm run infra:down` from `server/`.
Named Docker volumes are retained unless they are removed explicitly.

## Configuration

The backend loads and validates `server/.env`; the complete template is
[`server/.env.example`](server/.env.example). These are the principal runtime
settings:

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode; controls production cookies, CORS behavior, development mail logging, and the E2E safety check |
| `PORT` | `3000` | HTTP and Socket.IO listen port |
| `DATABASE_URL` | None | PostgreSQL connection string; required |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection used for coordination |
| `JWT_SECRET` | None | Session-signing secret; required and at least 16 characters |
| `JWT_EXPIRES_IN` | `7d` | JWT, cookie, and persisted session lifetime |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Public client origin used in action URLs and as the allowed browser origin outside development |
| `RESEND_API_KEY` | None | Enables password-reset and invitation email delivery |
| `MAIL_FROM` | `Meridian <no-reply@meridian.local>` | Sender used for application email |
| `ENABLE_TERMINAL` | `false` | Enables the server-hosted PTY terminal |
| `E2E_TEST` | `false` | Relaxes test limits and exposes scoped test helpers outside production |

In development, HTTP and Socket.IO CORS use the explicit localhost and
`127.0.0.1` allow-list for ports 5173 through 5175. `CLIENT_ORIGIN` still
controls generated invitation and password-reset URLs, but it does not extend
that development allow-list.

The client accepts these build-time Vite variables, typically through
`client/.env.local` or the build environment:

| Variable | Development default | Production default |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Browser page origin |
| `VITE_SOCKET_URL` | `http://localhost:3000` | Browser page origin |

For a same-site deployment that uses separate frontend and backend origins, set
both variables explicitly and set `CLIENT_ORIGIN` to the frontend origin. A
genuinely cross-site topology is not supported by configuration alone because
the authentication cookie uses `SameSite=Lax`.

## Testing and verification

### Server

```bash
cd server
npm run build
npm test
```

HTTP integration tests exercise the real NestJS request pipeline and require a
migrated PostgreSQL database:

```bash
cd server
npm run infra:up
npm run db:migrate
npm run test:integration
```

### Client

```bash
cd client
npm run lint
npm test
npm run build
```

`npm run build` includes the TypeScript project build before Vite creates the
production bundle.

### End-to-end

Install Chromium once:

```bash
cd client
npx playwright install chromium
```

For the complete suite, start the migrated backend in a non-production process:

```bash
cd server
E2E_TEST=true ENABLE_TERMINAL=true npm run start:dev
```

Then run Playwright in another terminal. Playwright starts and reuses the Vite
development server automatically.

```bash
cd client
MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e
```

Backend-dependent tests skip when the API cannot be reached. `E2E_TEST=true`
must never be used for normal operation; startup rejects it when
`NODE_ENV=production`. Run it only in an isolated local or CI process against a
disposable test database: its tightly scoped cleanup and password-reset helpers
are intentionally unauthenticated. The committed suites do not exercise
multi-process update ordering, cross-replica restore, Redis outage behavior, or
cross-replica terminal projection ordering.

## Production considerations

- This repository does not include a production deployment manifest or
  infrastructure definition. The component builds and operating constraints
  are documented, but the deployment topology must be supplied separately.
- Apply committed migrations with `npx prisma migrate deploy`; do not use
  `prisma migrate dev` in a production release.
- Build the server with `npm run build` and run `npm run start:prod`. Build the
  client with `npm run build` and serve `client/dist/` from a static host or
  reverse proxy. The NestJS server does not serve the client bundle. Configure
  an SPA history fallback, evaluate API proxy rules before that fallback, and
  forward WebSocket upgrades for `/socket.io/`. There is no `/api` prefix;
  proxy `/auth`, `/users`, `/workspaces`, `/documents`, `/invites`, `/health`,
  `/ready`, `/docs`, and `/docs-json` before applying the SPA fallback.
- Use TLS. Authentication cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`
  when `NODE_ENV=production`. The application does not install Helmet or a
  Content Security Policy; define the required response headers at the API
  ingress and static host.
- Deploy a single API replica to avoid the remaining cross-replica document
  state hazards. If the current multi-replica path is evaluated, use shared
  PostgreSQL and Redis and pin the entire Socket.IO session, including polling
  and transport upgrade, to one replica. PostgreSQL serializes durable update
  persistence and compaction, but restore is local-only and Redis Pub/Sub has no
  replay guarantee. An initial Redis connection failure is not retried; restore
  Redis and restart the API.
- HTTP throttling is process-local. The editor and terminal gateways apply
  independent per-socket event limits to their protected high-volume handlers.
  `leaveDocument` and `terminal:stop` are deliberately unmetered, while
  `terminal:input` is capped at 16,384 UTF-16 code units. Body parsing also
  occurs before authorization. Enforce request size, connection, and abuse
  limits at the ingress; Express `trust proxy` is not configured, so
  application IP-based throttling must not be treated as the client-address
  control behind a reverse proxy.
- The terminal is disabled by default. When enabled, it launches a host OS
  shell as the server user. Its temporary workspace directory, reduced
  environment, path validation, and authorization checks are not container or
  virtual-machine isolation. Keep it disabled for untrusted multi-tenant use
  unless the server process is isolated appropriately. Terminal file projection
  is one-way: saved document writes are copied into active sandboxes, but shell
  changes are not written back to the database or editor.
- Configure `RESEND_API_KEY` and a verified `MAIL_FROM` address when password
  reset or email invitations must be delivered. Without a provider, development
  logs action URLs; production records the delivery failure without revealing
  whether an account exists.
- Registration does not verify ownership of the supplied email address. Add an
  email-verification flow before treating email identity as verified.
- Invitation links are reusable bearer credentials until expiry. The recorded
  invite email is delivery metadata, not an acceptance constraint, and
  acceptance does not consume or revoke the token. Share links accordingly.
- Expired or revoked sessions, used password-reset tokens, and expired invites
  are rejected during use, but the application does not schedule row purging;
  define retention and cleanup outside the process.
- The Swagger UI is mounted at `/docs` in every environment. Restrict it at the
  ingress layer if the API schema should not be public.

Refer to the [client guide](client/README.md) and
[server guide](server/README.md) for component-specific commands, configuration,
test behavior, protocol details, and operating limits.

## License

No open-source license is included. Treat this repository as unlicensed unless
the owner provides separate terms.
