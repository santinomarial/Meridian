# Meridian server

The Meridian server is a NestJS 11 application that exposes REST and Socket.IO on the same port. PostgreSQL is the durable source of truth. Redis provides cross-instance event fan-out, authorization invalidation, terminal-sandbox synchronization, and document sequence allocation.

The server can run without Redis as a single process. Redis is required when more than one server replica is active.

## Runtime components

| Component | Responsibility |
|---|---|
| NestJS and Express | HTTP routing, validation, throttling, exception handling, Swagger, and Socket.IO integration |
| Prisma and PostgreSQL | Users, sessions, workspaces, memberships, invites, documents, version history, Yjs updates, and snapshots |
| Yjs | Authoritative in-memory state for open collaborative documents |
| Redis | Cross-instance Yjs, awareness, chat, authorization, sandbox events, and sequence counters |
| Pino | Structured request and application logs with request IDs and credential redaction |
| `node-pty` | Optional host-backed interactive terminal |

See [architecture.md](../docs/architecture.md) for the system design and [scaling.md](../docs/scaling.md) for the multi-replica model.

## Requirements

- Node.js 22, which is the version used by CI
- npm and the committed `package-lock.json`
- PostgreSQL 16 and, for the complete runtime, Redis 7
- Docker with Compose v2 for the bundled development infrastructure, or equivalent external services
- A native C/C++ build toolchain and Python on platforms where `node-pty` has no compatible prebuilt binary

Run server commands from this directory. Nest configuration loads `.env` relative to the current working directory.

## Local development

```bash
cd server
npm ci
cp .env.example .env
# Replace JWT_SECRET in .env with a strong random value, for example from:
openssl rand -base64 32

npm run infra:up
npm run db:migrate
npm run start:dev
```

The Compose file starts PostgreSQL on port 5432 and Redis on port 6379 using named volumes. Its published ports and default database credentials are intended for local development only.

After startup:

| URL | Purpose |
|---|---|
| `http://localhost:3000/health` | Process liveness |
| `http://localhost:3000/ready` | Dependency readiness |
| `http://localhost:3000/docs` | Swagger/OpenAPI UI |

`GET /health` returns 200 while the process is running. `GET /ready` returns 200 when PostgreSQL responds and 503 otherwise. Redis is reported as `ok`, `error`, or `disabled`, but it does not determine readiness because single-instance operation is supported. Dependency checks time out after two seconds.

### Optional demo data

```bash
npm run db:seed
```

The seed creates a `Meridian` workspace with these accounts:

| Account | Role |
|---|---|
| `alice@meridian.dev` | Owner |
| `bob@meridian.dev` | Editor |
| `carol@meridian.dev` | Editor |
| `dave@meridian.dev` | Viewer |

The development password is `Meridian1!`. Set `MERIDIAN_SEED_PASSWORD` to override it; the variable is mandatory when seeding with `NODE_ENV=production`.

The seed is for disposable environments. It updates the demo users' password hashes and document contents, and it replaces the seeded documents' CRDT histories. Do not run it against a database containing valued edits.

## Configuration

Application variables are validated at startup. Defaults below come from `src/config/env.validation.ts`; `.env.example` also supplies a local `DATABASE_URL`.

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `PORT` | `3000` | HTTP and Socket.IO listen port |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Browser origin and base URL used in invite/reset links; the exact CORS origin outside development |
| `DATABASE_URL` | Required | PostgreSQL connection string consumed by Prisma |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | Required | JWT signing secret; validation requires at least 16 characters, but production should use a high-entropy 32-byte or longer secret |
| `JWT_EXPIRES_IN` | `7d` | Session lifetime; accepts an integer followed by `ms`, `s`, `m`, `h`, `d`, `w`, or `y` |
| `LOG_LEVEL` | `info` | Pino log level |
| `DOC_TEARDOWN_GRACE_MS` | `30000` | Delay before an unused in-memory Yjs document is destroyed |
| `SNAPSHOT_EVERY_N_UPDATES` | `100` | Local persisted-update count that triggers a compaction attempt |
| `HTTP_TTL_SECONDS` | `60` | Default HTTP throttle window |
| `HTTP_LIMIT` | `120` | Requests allowed in the default window |
| `AUTH_TTL_SECONDS` | `60` | Additional throttle window for authentication endpoints |
| `AUTH_LIMIT` | `10` | Authentication requests allowed in the auth window |
| `WS_MESSAGE_LIMIT_PER_SECOND` | `50` | Per-socket inbound event limit |
| `WS_MAX_YJS_UPDATE_BYTES` | `1048576` | Maximum binary payload for Yjs sync, update, and awareness events |
| `ENABLE_TERMINAL` | `false` | Enables host-backed PTY events |
| `RESEND_API_KEY` | Unset | Resend API key for reset and invite email delivery |
| `MAIL_FROM` | `Meridian <no-reply@meridian.local>` | Sender passed to Resend |
| `FORGOT_PASSWORD_TTL_MINUTES` | `30` | Password-reset token validity |
| `E2E_TEST` | `false` | Enables test helpers and raises HTTP/WebSocket limits; rejected when `NODE_ENV=production` |

In development, CORS accepts localhost and `127.0.0.1` on Vite ports 5173-5175. In test and production it accepts only `CLIENT_ORIGIN`. Both HTTP and Socket.IO allow credentials.

When `RESEND_API_KEY` is absent in development, reset and invite URLs are printed to the server console. In production, missing mail configuration is logged as an internal delivery failure. Password-reset requests still return a generic response, and invite creation still returns the shareable link.

## Commands

| Command | Behavior |
|---|---|
| `npm run start:dev` | Start Nest in watch mode |
| `npm start` | Start Nest without watch mode |
| `npm run build` | Compile `src/` to `dist/` |
| `npm run start:prod` | Run `node dist/main.js`; requires a prior build |
| `npm test` | Run colocated Jest unit tests |
| `npm run test:integration` | Run `server/test/**/*.e2e-spec.ts` serially with the real application and database |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:migrate` | Run `prisma migrate dev`; create/apply development migrations |
| `npm run db:studio` | Start Prisma Studio |
| `npm run db:seed` | Run the TypeScript seed through Prisma |
| `npm run infra:up` | Start the development PostgreSQL and Redis containers |
| `npm run infra:down` | Stop the Compose services without deleting named volumes |

`npm ci` runs a best-effort postinstall script that restores the executable bit on the Unix `node-pty` spawn helper.

## HTTP API

Swagger at `/docs` is the complete route and schema reference. It is registered in every environment and has no application-level authentication; restrict it at the reverse proxy if it should not be public.

The main route groups are:

| Routes | Access and behavior |
|---|---|
| `/auth/register`, `/auth/login` | Public; create a database-backed session, set the `auth_token` cookie, and return the JWT with the user |
| `/auth/me`, `/auth/logout` | Require an active session; logout revokes that session and disconnects its realtime sockets |
| `/auth/forgot-password`, `/auth/reset-password` | Public reset flow; tokens are stored as hashes, are single-use, and a successful reset revokes every active session for the user |
| `/users/:userId` | Authenticated profile read; update and delete are self-only |
| `/workspaces` and `/workspaces/:workspaceId` | Authenticated workspace create/list/read/update/delete |
| `/workspaces/:workspaceId/members` | Owner-managed membership; generic member APIs cannot assign, demote, or remove the canonical owner |
| `/workspaces/:workspaceId/invites` | Owner-only create/list; invite links expire after seven days |
| `/invites/:token` | Public invite metadata; accepting an invite requires authentication |
| `/workspaces/:workspaceId/documents` | Member reads and editor/owner document creation |
| `/workspaces/:workspaceId/documents/bulk` | Transactional project import with path and content limits |
| `/workspaces/:workspaceId/export` | Any member, including viewers; returns a ZIP assembled from saved database content |
| `/documents/:documentId` | Member read; editor/owner update/delete |
| `/documents/:documentId/versions` | Version list/detail for members and restore for editors/owners |

Non-members normally receive 404 for private workspace/document resources rather than a response that confirms the resource exists. Viewers can read documents, versions, and exports but cannot mutate documents, restore versions, send Yjs writes, or use the terminal.

Deleting a user also deletes every workspace they own and the dependent workspace data in the same database transaction. It then revokes the user's realtime access and clears the browser cookie. This operation is irreversible and requires an active session, but it does not require password re-entry.

### Authentication

Passwords are hashed with Argon2id. Registration and reset passwords must contain at least eight characters, one uppercase letter, one lowercase letter, one number, and one non-alphanumeric character.

Each JWT contains a session JTI. Guarded HTTP requests verify the signature and then load the corresponding `Session` row to check ownership, expiry, and revocation. Tokens may be supplied through either:

- the `auth_token` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production); or
- `Authorization: Bearer <token>`.

An invalid cookie is cleared when a guarded request returns 401. Login and registration replace an existing cookie with a new session.

The application does not terminate TLS. Production must use HTTPS at a trusted reverse proxy or load balancer. If the client and API are deployed on different sites, review the cookie `SameSite` policy and add an explicit CSRF design before changing it.

### Validation and request limits

Global validation strips no unknown properties: unknown DTO fields are rejected, and supported fields are transformed by Nest's validation pipeline. JSON parser limits are route-specific:

| Request class | Wire limit |
|---|---|
| General JSON endpoints | 100 KiB |
| Single-document create/update routes | 7 MiB |
| Bulk document import | 26 MiB |

Independent semantic document limits also apply:

- 1 MiB of UTF-8 content per document
- 1,000 files and 2,000 total file/folder nodes per bulk import
- 25 MiB of aggregate UTF-8 content per bulk import
- 4,096 UTF-8 bytes per path, 255 bytes per path segment, and 64 path segments

Callers must satisfy both the JSON wire limit and the semantic limits. Malformed JSON returns 400 and oversized requests return 413.

Every error response includes `statusCode`, `error`, `message`, `requestId`, `timestamp`, and `path`. Unexpected 5xx details are logged server-side and replaced with `Internal server error` in the response.

## Realtime collaboration

Socket.IO uses the same port and CORS policy as HTTP. The connection handshake accepts the JWT from `socket.handshake.auth.token` or the `auth_token` cookie and verifies the database session before accepting the socket.

Core client events are:

| Event | Purpose |
|---|---|
| `joinWorkspace` | Authorize and join a workspace room for chat |
| `chat:message` | Send a workspace chat message |
| `joinDocument`, `leaveDocument` | Manage document membership, reference counts, and awareness cleanup |
| `yjs:sync` | Read-only synchronization; accepts SyncStep1 requests, ignores client SyncStep2, and rejects mutating sync messages |
| `yjs:update` | Apply, relay, persist, and cross-publish an editor/owner update |
| `awareness:update` | Relay ephemeral cursor/selection state |

The gateway requires exact room membership and rechecks both the session and current workspace role on protected events. Authorization results are cached for at most one second. Logout, password reset, account deletion, membership changes, and workspace deletion publish local and Redis invalidations; a ten-second audit sweep provides a fallback for passive sockets. Removed users are evicted from workspace/document rooms, and revoked sessions are disconnected.

Inbound events use a fixed one-second per-socket rate window. Yjs sync, update, and awareness payloads share the configured byte limit. Awareness is ephemeral and is not stored in PostgreSQL.

### Yjs persistence

An open document has one reference-counted `Y.Doc` and `Awareness` instance per server process. A cold load applies the latest snapshot followed by later `DocumentUpdate` rows. If no CRDT history exists, the server deterministically seeds Yjs from the document's saved `content` column.

`yjs:update` follows this path:

1. Apply to the in-memory document.
2. Relay to other sockets in the local document room.
3. Queue a PostgreSQL `DocumentUpdate` write in a per-document promise chain.
4. Publish the update through Redis for other replicas.

Sequence numbers use an atomic Redis counter seeded from the PostgreSQL high-water mark. In single-instance fallback mode, they use a process-local counter. Compaction reconstructs a snapshot from durable rows and replaces covered updates in a serializable transaction.

Persistence is asynchronous so editing is not blocked on PostgreSQL. Graceful application shutdown flushes pending write chains, but an abrupt process or host failure can lose updates that were accepted in memory and had not yet reached PostgreSQL. Configure an adequate termination grace period and monitor persistence errors.

A meaningful REST content save creates a plain-text `DocumentVersion` in the same transaction as the document update. Restoring a version updates the saved content, reconciles a live Yjs document when present, resets obsolete CRDT history, publishes the restored state, and synchronizes active terminal projections.

### Redis and multiple replicas

Redis is optional only for one server process. A multi-replica deployment requires:

- one shared PostgreSQL database;
- one shared Redis deployment; and
- sticky routing for each Socket.IO connection.

Redis fans out document updates, awareness, chat, authorization invalidations, and terminal file operations. It also owns the cross-process document sequence counter. Without Redis, those facilities fall back to single-process behavior and multiple replicas can allocate conflicting sequence numbers.

Redis connection attempts use a three-second startup timeout and do not automatically reconnect after an initial connection failure; restart the server after restoring Redis. Redis is not part of the readiness decision, so production monitoring must alert on its reported state separately when horizontal scaling is enabled.

## Optional terminal

`ENABLE_TERMINAL=false` is the secure default. When enabled, the server materializes saved workspace documents under the operating system's temporary directory and starts an interactive `node-pty` shell there. One terminal session is tracked per socket, with a 30-minute idle timeout and a four-hour absolute lifetime. Python, JavaScript, TypeScript, and shell run-file actions depend on `python3`, `node`, `tsx`, and `bash` being installed in the server runtime.

Terminal start, input, resize, and run-file events revalidate the database session and workspace role. Viewers and non-members are rejected. Membership/session invalidations kill affected PTYs locally and across replicas. Document writes are projected to active sandboxes and published through Redis.

The terminal sandbox is not an operating-system security boundary. The shell runs as the server's OS user and can access anything that user can access; changing its working directory and environment does not provide container, namespace, or filesystem isolation. Do not enable it for untrusted or multi-tenant workloads without an external isolation layer. At minimum, run the server as a dedicated unprivileged user with no host secrets or infrastructure credentials available to the shell process.

Sandbox files are temporary host files. They may remain until the host cleans its temporary directory or the same workspace/user sandbox is re-materialized. Provision and monitor temporary storage accordingly.

## Database and migrations

The Prisma schema is in `prisma/schema.prisma`; committed migrations are in `prisma/migrations/`.

- Use `npm run db:migrate` only for local migration development.
- Apply committed migrations in a release step with `npx prisma migrate deploy`.
- Run `npm run db:generate` after schema changes and before compiling against a newly installed client.
- Back up PostgreSQL independently; Redis pub/sub and counters are coordination state, not the durable record of workspaces.

The main persistence models are `User`, `Session`, `PasswordResetToken`, `Workspace`, `WorkspaceMember`, `Invite`, `Document`, `DocumentVersion`, `DocumentUpdate`, and `Snapshot`. Workspace paths are unique per workspace. Cascades remove dependent memberships, invites, documents, versions, updates, and snapshots when a workspace is deleted.

## Testing

Unit tests do not require running PostgreSQL or Redis:

```bash
npm test
```

HTTP integration tests boot the real `AppModule` under Supertest and use the configured database. Start and migrate the development infrastructure first:

```bash
npm run infra:up
npm run db:migrate
npm run test:integration
```

The integration suite creates prefixed synthetic accounts and removes them afterward. Use a disposable test database despite that cleanup boundary. CI uses PostgreSQL 16, Redis 7, Node 22, `prisma migrate deploy`, and serial integration execution.

Browser end-to-end tests live in the client package; see the [client test documentation](../client/README.md).

### E2E-only server mode

`E2E_TEST=true` raises HTTP and WebSocket rate limits and enables two Swagger-hidden helper endpoints:

- `POST /e2e/cleanup` with an allow-listed synthetic email prefix
- `POST /auth/e2e/password-reset-token` with an allow-listed synthetic `@example.com` address

The cleanup operation deletes matching test-owned workspaces and users in one transaction. The reset helper returns a raw reset token. Both routes return 404 when test mode is disabled or the process is in production, and startup rejects `E2E_TEST=true` with `NODE_ENV=production`.

These helper routes have no separate authentication. Prefix/domain validation limits their database scope, but an E2E-enabled server must still be isolated from untrusted networks and must never share a database with production.

## Production checklist

1. Build with the lockfile: `npm ci`, `npm run db:generate`, and `npm run build`.
2. Apply committed migrations with `npx prisma migrate deploy` in a release job.
3. Set `NODE_ENV=production`, a high-entropy `JWT_SECRET`, the production database and Redis URLs, the exact `CLIENT_ORIGIN`, and working Resend configuration.
4. Terminate HTTPS at a trusted proxy, forward WebSocket upgrades, enforce request-size/time limits, and use sticky Socket.IO routing when running multiple replicas.
5. Keep `E2E_TEST=false`. Keep `ENABLE_TERMINAL=false` unless the runtime has an external isolation boundary.
6. Restrict database, Redis, Swagger, logs, and temporary storage according to their sensitivity; do not expose the development Compose services.
7. Give the process enough shutdown grace for pending document writes, and alert on PostgreSQL readiness, Redis availability, persistence errors, mail failures, and terminal resource use.
8. Back up PostgreSQL and test restoration procedures.

Invite and password-reset URLs are bearer credentials. They can appear in browser history and, for URL-token routes, request logs. Limit log access and retention, avoid forwarding full sensitive URLs to analytics, and rotate or expire exposed links.
