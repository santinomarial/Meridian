# Meridian

Meridian is a full-stack collaborative browser IDE. It combines a React and
Monaco client with a NestJS API, Yjs-based realtime editing, PostgreSQL
persistence, and Redis coordination for multi-instance deployments.

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
- Structured logging, request identifiers, HTTP and WebSocket rate limits,
  health probes, readiness checks, and generated OpenAPI documentation.
- A clearly labeled, non-persistent local demonstration workspace when backend
  workspace loading fails; authentication failures return to sign-in instead.

## Architecture

| Component | Implementation | Responsibility |
|---|---|---|
| Web client | React 18, TypeScript, Vite, Monaco, Zustand | Workspace UI, editor state, REST calls, and realtime bindings |
| API server | NestJS 11, TypeScript, Socket.IO | Authentication, authorization, workspace and document APIs, realtime rooms, and terminal sessions |
| Primary datastore | PostgreSQL 16, Prisma | Users, sessions, memberships, documents, invitations, versions, Yjs updates, and snapshots |
| Coordination | Redis 7, ioredis | Cross-instance realtime fan-out, authorization invalidation, sequence allocation, chat, and terminal file synchronization |

PostgreSQL stores the durable application state. Each active collaborative
document also has an in-memory `Y.Doc`; incremental updates are queued for
asynchronous persistence and periodically compacted into snapshots. A database
write failure is logged; the affected update can be lost once no connected
client or server memory retains it. Redis is optional for a single server
process and required when more than one server instance is active.

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
are intentionally unauthenticated.

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
  when `NODE_ENV=production`.
- For multiple API replicas, use shared PostgreSQL and Redis services and keep
  each Socket.IO connection pinned to the instance that accepted it. If Redis
  is unavailable, run only one server instance. The server does not retry an
  initial Redis connection failure; start Redis first or restart the API after
  Redis becomes available.
- HTTP throttling is per server process and WebSocket throttling is per socket.
  Apply ingress-level request limits and abuse controls when running multiple
  replicas or accepting untrusted public traffic.
- The terminal is disabled by default. When enabled, it launches a host OS
  shell as the server user. Its temporary workspace directory, reduced
  environment, path validation, and authorization checks are not container or
  virtual-machine isolation. Keep it disabled for untrusted multi-tenant use
  unless the server process is isolated appropriately.
- Configure `RESEND_API_KEY` and a verified `MAIL_FROM` address when password
  reset or email invitations must be delivered. Without a provider, development
  logs action URLs; production records the delivery failure without revealing
  whether an account exists.
- Registration does not verify ownership of the supplied email address. Add an
  email-verification flow before treating email identity as verified.
- The Swagger UI is mounted at `/docs` in every environment. Restrict it at the
  ingress layer if the API schema should not be public.

Refer to the [client guide](client/README.md) and
[server guide](server/README.md) for component-specific commands, configuration,
test behavior, protocol details, and operating limits.

## License

No open-source license is included. Treat this repository as unlicensed unless
the owner provides separate terms.
