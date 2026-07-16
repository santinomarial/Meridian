# Meridian Server

Meridian's server is a NestJS 11 application that exposes an HTTP API and a Socket.IO endpoint on one port. PostgreSQL stores accounts, authorization state, workspace metadata, saved document content, version history, and persisted Yjs history. Redis provides optional cross-process coordination; it is not a durable data store.

The recommended deployment is one server process backed by PostgreSQL. Durable
Yjs writes and compaction are serialized across processes by PostgreSQL, but
live Redis fan-out and version restore still do not provide a complete
multi-replica consistency model. See
[Deployment topology and Redis](#deployment-topology-and-redis) before adding
replicas.

For system-wide context, see [architecture.md](../docs/architecture.md). For capacity and failure-mode analysis, see [scaling.md](../docs/scaling.md).

## Runtime components

| Component | Responsibility |
|---|---|
| NestJS and Express | HTTP routing, validation, throttling, exception handling, Swagger, and Socket.IO integration |
| Prisma and PostgreSQL | Users, sessions, workspaces, memberships, invites, document metadata and saved content, versions, Yjs updates, and snapshots |
| Yjs | Live collaborative state in one in-memory `Y.Doc` per open document per process |
| Redis | Best-effort event fan-out, authorization invalidation, terminal projection operations, and accelerated document sequence allocation |
| Pino | Structured HTTP and application logs; HTTP request/error entries include request IDs, and selected credential fields are redacted |
| `node-pty` | Optional host-backed interactive terminal |

PostgreSQL contains two current-state representations of a file's text, in addition to historical `DocumentVersion` rows:

| Representation | Written by | Read by |
|---|---|---|
| `Document.content` | HTTP document create/update/import/restore operations | Workspace reads, version creation, ZIP export, and terminal materialization |
| `DocumentUpdate` and `Snapshot` | Collaborative `yjs:update` events, initial Yjs seeding, compaction, and restore reconciliation | Yjs cold load and live collaboration |

These representations are related but are not continuously synchronized. The boundary is described in [Document state and persistence](#document-state-and-persistence).

## Requirements

- Node.js 22.12 or later; CI uses Node.js 22, and the repository's Vite 8 client requires 22.12 or later
- npm and the committed `package-lock.json`
- PostgreSQL; the development Compose file and CI use PostgreSQL 16
- Redis only when its coordination features are required; the development Compose file and CI use Redis 7
- Docker with Compose v2 for the bundled development infrastructure, or equivalent external services
- A native C/C++ build toolchain and Python when `node-pty` has no compatible prebuilt binary for the target platform

Run server commands from this directory. Nest loads `.env` relative to the current working directory.

## Local development

```bash
cd server
npm ci
cp .env.example .env
# Replace JWT_SECRET with a high-entropy value, for example:
openssl rand -base64 32

npm run infra:up
docker compose exec postgres pg_isready -U postgres
docker compose exec redis redis-cli ping
npm run db:migrate
npm run start:dev
```

The Compose file publishes PostgreSQL on port 5432 and Redis on port 6379 and retains both in named volumes. Its ports and database credentials are for local development only. The services have no Compose health checks, so wait for PostgreSQL to accept connections and Redis to return `PONG` before applying migrations or starting the application.

After startup:

| URL | Purpose |
|---|---|
| `http://localhost:3000/health` | Process liveness |
| `http://localhost:3000/ready` | Dependency readiness |
| `http://localhost:3000/docs` | Swagger UI |
| `http://localhost:3000/docs-json` | Generated OpenAPI document |

`GET /health` returns 200 while the process can serve the route; it does not test dependencies. `GET /ready` waits up to two seconds for each dependency check. PostgreSQL alone determines the HTTP status: PostgreSQL success returns 200 even when Redis is `error` or `disabled`, and PostgreSQL failure returns 503. A successful response includes both dependency states. The global exception filter sanitizes the failed 503 response to the standard internal-error envelope, so the detailed dependency object is not preserved in that response.

### Optional demo data

```bash
npm run db:seed
```

The seed creates a `Meridian` workspace and four accounts:

| Account | Role |
|---|---|
| `alice@meridian.dev` | Owner |
| `bob@meridian.dev` | Editor |
| `carol@meridian.dev` | Editor |
| `dave@meridian.dev` | Viewer |

The default development password is `Meridian1!`. Set `MERIDIAN_SEED_PASSWORD` to override it. That variable is required when seeding with `NODE_ENV=production`.

The seed is intended for disposable environments. It updates the demo users' password hashes and document content and replaces the seeded documents' CRDT histories. Do not run it against a database containing work that must be preserved.

## Configuration

`src/config/env.validation.ts` validates application configuration at startup. `.env.example` supplies local values for variables that have no application default.

| Variable | Application default | Meaning |
|---|---|---|
| `NODE_ENV` | `development` | One of `development`, `test`, or `production` |
| `PORT` | `3000` | HTTP and Socket.IO listen port |
| `CLIENT_ORIGIN` | `http://localhost:5173` | Base URL for invite/reset links and the exact allowed browser origin outside development |
| `DATABASE_URL` | None | PostgreSQL connection string used by Prisma; required |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string; a connection failure during module initialization does not prevent startup |
| `JWT_SECRET` | None | JWT signing secret; startup requires at least 16 characters, while production should use at least 32 random bytes |
| `JWT_EXPIRES_IN` | `7d` | JWT and session lifetime; accepts an integer followed by `ms`, `s`, `m`, `h`, `d`, `w`, or `y` |
| `LOG_LEVEL` | `info` | Pino log level |
| `DOC_TEARDOWN_GRACE_MS` | `30000` | Delay before an unused in-memory Yjs document is destroyed |
| `SNAPSHOT_EVERY_N_UPDATES` | `100` | Number of locally persisted updates between compaction attempts |
| `HTTP_TTL_SECONDS` | `60` | Default HTTP throttle window |
| `HTTP_LIMIT` | `120` | Requests allowed in the default HTTP window |
| `AUTH_TTL_SECONDS` | `60` | Additional throttle window applied to `/auth` routes |
| `AUTH_LIMIT` | `10` | Requests allowed in the auth window |
| `WS_MESSAGE_LIMIT_PER_SECOND` | `50` | Per-socket limit for rate-checked collaboration events in `EditorGateway` |
| `WS_MAX_YJS_UPDATE_BYTES` | `1048576` | Maximum binary payload accepted by Yjs sync, update, and awareness handlers |
| `ENABLE_TERMINAL` | `false` | Enables host-backed PTY events and terminal projection subscriptions |
| `RESEND_API_KEY` | Unset | Resend API key for password-reset and invite email delivery |
| `MAIL_FROM` | `Meridian <no-reply@meridian.local>` | Sender passed to Resend |
| `FORGOT_PASSWORD_TTL_MINUTES` | `30` | Password-reset token lifetime |
| `E2E_TEST` | `false` | Enables test helpers and raises configured HTTP/editor-event limits; rejected in production |

In development, HTTP and Socket.IO CORS accept only `localhost` and `127.0.0.1` on ports 5173 through 5175. `CLIENT_ORIGIN` does not expand that development allowlist; it still controls generated invite and reset URLs. In test and production, CORS accepts only the exact `CLIENT_ORIGIN`. Credentials are enabled for both transports.

When `RESEND_API_KEY` is absent in development, invite and reset URLs are printed to the process console. Outside development, delivery fails internally and is logged. Password-reset requests keep their generic success response, and invite creation still returns the shareable URL.

`FORGOT_PASSWORD_TTL_MINUTES` controls token validity, but the current email templates always state that the link expires in 30 minutes. Keep the variable at 30 until the template is wired to configuration, or the email text will be inaccurate.

## Commands

| Command | Behavior |
|---|---|
| `npm run start:dev` | Start Nest in watch mode |
| `npm start` | Start Nest without watch mode |
| `npm run build` | Compile `src/` to `dist/` |
| `npm run start:prod` | Run `node dist/main.js`; requires a prior build |
| `npm test` | Run colocated Jest unit tests |
| `npm run test:integration` | Run `server/test/**/*.e2e-spec.ts` serially against the real application and database |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:migrate` | Run `prisma migrate dev` for local migration development |
| `npm run db:studio` | Start Prisma Studio |
| `npm run db:seed` | Run the TypeScript seed |
| `npm run infra:up` | Start the development PostgreSQL and Redis services |
| `npm run infra:down` | Stop Compose services without deleting named volumes |

`npm ci` runs a best-effort postinstall script that restores the executable bit on known Unix `node-pty` spawn-helper paths.

## HTTP API

Swagger at `/docs` is the generated route and schema reference. It is registered in every environment and has no application-level authentication. Restrict or disable it at the ingress if it must not be public.

The primary route groups are:

| Routes | Access and behavior |
|---|---|
| `/auth/register`, `/auth/login` | Public; create a database-backed session, set the `auth_token` cookie, and return the JWT and user |
| `/auth/me`, `/auth/logout` | Require an active session; logout revokes that session and disconnects its realtime sockets |
| `/auth/forgot-password`, `/auth/reset-password` | Public reset flow; raw tokens are not stored, reset tokens are single-use, and successful reset revokes every active session for the user |
| `/users/:userId` | Authenticated profile read; update and delete are self-only |
| `/workspaces` and `/workspaces/:workspaceId` | Authenticated workspace create, list, read, update, and delete |
| `/workspaces/:workspaceId/members` | Owner-managed membership; generic membership operations cannot replace, demote, or remove the canonical owner |
| `/workspaces/:workspaceId/invites` | Owner-only invite create/list; links expire after seven days |
| `/invites/:token` | Public metadata; acceptance requires authentication |
| `/workspaces/:workspaceId/documents` | Member reads and editor/owner document creation |
| `/workspaces/:workspaceId/documents/bulk` | Transactional project import with path and content limits |
| `/workspaces/:workspaceId/export` | Any member, including viewers; returns a ZIP of saved `Document.content` |
| `/documents/:documentId` | Member read and editor/owner update/delete |
| `/documents/:documentId/versions` | Version list/detail for members and restore for editors/owners |

Non-members normally receive 404 for private workspace and document resources to avoid confirming that an identifier exists. Viewers can read documents, versions, and exports but cannot mutate documents, restore versions, send Yjs writes, or use the terminal.

Deleting a user also deletes workspaces they own and dependent data in the same database transaction, then invalidates realtime access and clears the browser cookie. The operation is irreversible and requires an active session, but not password re-entry.

### Authentication and cookies

Passwords use Argon2id. Registration and reset passwords require at least eight characters, one uppercase character, one lowercase character, one number, and one non-alphanumeric character. Registration does not verify control of the supplied email address.

Each JWT contains a session JTI. Guarded requests verify the JWT and load the corresponding `Session` row to enforce expiry and revocation. Tokens may be supplied through:

- the `auth_token` cookie, which is `HttpOnly`, `SameSite=Lax`, `Secure` in production, and scoped to `/`; or
- `Authorization: Bearer <token>`.

An invalid cookie is cleared on a guarded 401 response. Login and registration create a new session and replace the existing cookie value; they do not revoke prior sessions.

The application does not terminate TLS or install Helmet, a Content Security
Policy, or separate CSRF middleware. Production requires HTTPS and an explicit
security-header policy at a trusted reverse proxy, load balancer, and static
host. The default cookie supports the intended same-site browser topology. A
cross-site frontend requires a coordinated review of cookie attributes, CORS,
credential transport, and CSRF protection before deployment.

### Invites

Invite tokens are bearer credentials. The optional `email` field is delivery metadata only: acceptance does not verify that the authenticated user's email matches it. `acceptedAt` records the first acceptance but does not consume the token. Any number of authenticated users holding the same token may accept it until expiration, subject to existing membership behavior.

Invites can grant only `EDITOR` or `VIEWER`. There is no invite-revocation endpoint. Treat invite URLs as reusable secrets and avoid placing them in analytics or broadly accessible logs.

### Validation, body limits, and throttling

Global DTO validation transforms supported values and rejects unknown properties. HTTP JSON parser limits are route-specific:

| Request class | Wire limit |
|---|---|
| General JSON endpoints | 100 KiB |
| Single-document create/update routes | 7 MiB |
| Bulk document import | 26 MiB |

Independent semantic limits are:

- 1 MiB of UTF-8 content per document
- 1,000 files and 2,000 total file/folder nodes per bulk import
- 25 MiB of aggregate UTF-8 content per bulk import
- 4,096 UTF-8 bytes per path, 255 bytes per path segment, and 64 path segments

Callers must satisfy both the wire and semantic limits. Malformed JSON returns
400 and an oversized request body returns 413. Body parsing occurs before Nest
guards and controller authorization, so an ingress should reject oversized and
slow requests before they consume application resources.

The Nest throttler uses process-local storage. The default window applies broadly; `/auth` routes also receive the stricter auth window. Limits therefore multiply with the replica count and are not a distributed abuse-control boundary. The application does not configure Express `trust proxy`, so proxy topology also affects the client address observed by HTTP throttling. Configure trusted proxy handling deliberately and enforce authoritative rate limits at the ingress.

Most errors use an envelope containing `statusCode`, `error`, `message`, `requestId`, `timestamp`, and `path`. Unexpected 5xx details are logged and replaced with `Internal server error`. This sanitization also replaces intentional 5xx response details, including the dependency object from a failed readiness probe.

## Realtime collaboration

Socket.IO uses the HTTP port and CORS policy. Handshake authentication reads the JWT from `socket.handshake.auth.token` or the `auth_token` cookie and validates the corresponding database session before accepting the socket.

Core collaboration events are:

| Client event | Purpose |
|---|---|
| `joinWorkspace` | Authorize and join a workspace chat room |
| `chat:message` | Relay a workspace chat message |
| `joinDocument`, `leaveDocument` | Manage document room membership, Yjs references, and awareness cleanup |
| `yjs:sync` | Read-only synchronization; accepts SyncStep1, ignores SyncStep2, and rejects mutating sync messages |
| `yjs:update` | Apply, relay, asynchronously persist, and optionally cross-publish an editor/owner update |
| `awareness:update` | Relay ephemeral Yjs awareness state |

Protected events require the exact Socket.IO room relationship and revalidate both the session and current role, with authorization results cached for at most one second. Logout, password reset, account deletion, membership changes, and workspace deletion trigger local invalidations and, when Redis works, cross-process invalidations. A ten-second audit sweep is the passive-socket fallback.

The configured one-second rate limiter applies to `joinWorkspace`, `chat:message`, `joinDocument`, `yjs:sync`, `yjs:update`, and `awareness:update` in `EditorGateway`. `leaveDocument` is not checked. Terminal events use a different gateway and are not covered. Yjs sync, update, and awareness payloads use `WS_MAX_YJS_UPDATE_BYTES`.

Awareness is ephemeral and is never written to PostgreSQL. The server authorizes the socket and bounds the binary payload, but the user metadata inside an awareness update is client-asserted and is not rebound to the authenticated account. Do not use awareness fields as an authorization or audit identity. Chat sender identity, by contrast, is constructed by the server from the authenticated user.

### Document state and persistence

An open document has one reference-counted `Y.Doc` and `Awareness` instance per server process. A cold load applies the latest snapshot and then updates whose sequence is greater than that snapshot. When no CRDT history exists, the server deterministically seeds Yjs from `Document.content` and attempts to persist the seed as sequence 0.

`yjs:update` performs these operations:

1. Apply the update to the process-local `Y.Doc`.
2. Relay it to other local sockets in the document room.
3. Enqueue an asynchronous PostgreSQL `DocumentUpdate` insert in a process-local per-document promise chain.
4. Publish the update through Redis when Redis is available.

The accepted edit is visible before the database write completes. Graceful application shutdown waits for queued writes, but an abrupt process or host failure can lose accepted updates that have not reached PostgreSQL. Persistence failures are logged and swallowed so later collaboration continues.

Yjs collaboration does not update `Document.content`. Conversely, ordinary HTTP document updates and bulk import do not reset existing Yjs history or mutate an already loaded `Y.Doc`. The practical boundaries are:

- HTTP `PATCH /documents/:documentId` writes saved content. If content differs, it creates a plain-text `DocumentVersion` in the same transaction.
- ZIP export and terminal materialization read saved `Document.content`, not the live `Y.Doc`.
- Unsaved collaborative text can be durable in `DocumentUpdate` rows while remaining absent from exports, versions, and new terminal projections.
- A normal client save is consistent when it sends the current Yjs text through HTTP PATCH. An out-of-band PATCH or import over a document with existing Yjs history can create divergence; a later collaborative cold load follows the Yjs history, not the newly imported content.
- Version restore is the only HTTP path that explicitly attempts to reconcile the saved and CRDT representations.

Version numbers are calculated as the current maximum plus one. The database uniqueness constraint detects concurrent allocation of the same number, but the application has no retry path; concurrent meaningful saves may therefore fail one request.

The ZIP exporter assembles the complete archive in process memory. Bulk import has an aggregate 25 MiB limit, but a workspace can grow beyond that through repeated creates or updates because there is no aggregate workspace-size quota. Large exports can therefore consume substantially more memory than the per-document limit suggests.

### Compaction and sequence allocation

The local promise chain batches writes and supports graceful shutdown, but it is
not the cross-process ordering mechanism. Every durable write begins a
PostgreSQL transaction, acquires a transaction-scoped advisory lock derived from
the document ID, allocates and inserts the next sequence, then commits. Redis
provides the fast shared counter when available; if it is unavailable, the
locked transaction derives the next value from the durable update/snapshot
high-water mark. Compaction and history reset acquire the same lock before
reading, deleting, or replacing history.

This prevents a lower sequence from being inserted after another replica has
compacted through a higher sequence. It does not make live collaboration fully
safe across replicas: accepted updates still have no durability acknowledgement,
Redis Pub/Sub has no replay, and version restore remains local-only.

The persistence service also retains per-document write chains, Redis seed
flags, compaction counters, and last-sequence entries for the lifetime of the
process after a document is touched. The live `Y.Doc` itself is torn down after
its configured grace period, but those persistence bookkeeping maps are not
evicted.

### Version restore

Restore is a multi-step operation:

1. A PostgreSQL transaction updates `Document.content` and creates a new version.
2. After that transaction commits, `DocumentRestoreService` mutates a live process-local `Y.Doc` when present, emits local Socket.IO events, and replaces or deletes persisted CRDT history.
3. The controller then applies a best-effort terminal file projection update.

These steps are not one atomic transaction. A failure after step 1 can leave saved content committed while CRDT history, connected editors, or terminal files remain unreconciled. Restore broadcasts only through the local Socket.IO server; it does not publish the restored update or notification through Redis. Other replicas can retain stale in-memory documents and pending writes, and clearing the shared sequence key does not invalidate those states. Do not run version restore against a document served by multiple replicas.

## Deployment topology and Redis

### Supported consistency topology

Use one Meridian server process for document correctness. PostgreSQL is required. Redis is optional in that topology and adds no durability; when enabled, it supports coordination features and makes local development closer to CI.

Multiple replicas are not currently recommended for production, even with
shared PostgreSQL and Redis. PostgreSQL now orders durable update persistence
and compaction, but restore's local-only reconciliation remains a blocker.
Redis Pub/Sub also provides no replay, acknowledgement, or total ordering for
collaboration, authorization invalidation, chat, awareness, or sandbox
operations.

If multiple replicas are used for evaluation, they require:

- one shared PostgreSQL database;
- one shared, private Redis deployment; and
- sticky routing for the entire Socket.IO session, including HTTP long-polling requests and any WebSocket upgrade.

Redis messages are treated as trusted internal input. Keep Redis network access restricted and authenticated according to the deployment environment.

### Redis failure behavior

Both Redis clients use lazy connection, a three-second startup timeout, no offline queue, and no retry strategy. If either startup connection fails, the application logs a warning, marks Redis unavailable, and continues in single-process mode. It does not reconnect automatically; restart the process after Redis is restored.

After a connection was established, a later client error or close does not
change the service's `isAvailable` flag. Publish operations log and drop failed
messages. A failed Redis sequence operation falls back to the PostgreSQL
high-water mark while holding the document advisory lock, so durable sequence
ordering remains intact. Cross-replica fan-out, awareness, chat, authorization
invalidation, and terminal projection still fail open while replicas continue
serving traffic. The application does not reduce the replica count or fail
readiness automatically.

Readiness returns HTTP 200 whenever PostgreSQL is healthy, including when the Redis check reports `error` or `disabled`. Monitor Redis separately and treat any loss of Redis as an incident if evaluating multiple replicas.

## Optional terminal

`ENABLE_TERMINAL=false` is the secure default. When enabled, the server materializes saved workspace documents beneath the operating system's temporary directory and starts an interactive `node-pty` shell there. One terminal session is tracked per socket, with a 30-minute idle timeout and a four-hour absolute lifetime. Run-file actions require `python3`, `node`, `tsx`, or `bash` in the server runtime, depending on file type.

Terminal start, input, resize, and run-file handlers revalidate session and workspace role. Viewers and non-members are rejected. Membership and session invalidations terminate affected local PTYs and use Redis to notify other processes when available.

The projection is intentionally one-way:

- HTTP document create, import, update, delete, and restore operations are projected to active sandboxes on a best-effort basis.
- Live Yjs updates do not update `Document.content` and are not projected directly.
- Changes made by shell commands are never written back to PostgreSQL, Yjs, version history, or ZIP export.
- Re-materializing a sandbox deletes and rebuilds it from saved database content, discarding terminal-only changes.

Cross-process file operations use Redis Pub/Sub with no replay, acknowledgement, deduplication, or global ordering. Missed or reordered operations can leave a sandbox stale until it is re-materialized. The server emits a sync-failure signal when a local operation throws, but publication is fire-and-forget.

Terminal events have no application-level rate limiter. `terminal:input` validates only that `data` is a string and has no terminal-specific length cap. Enforce Socket.IO and ingress limits appropriate to the deployment.

On a natural PTY exit, `TerminalService` clears timers and removes the session but does not unregister the corresponding active sandbox entry. That stale registry entry and its temporary files can remain until the socket starts another session with the same ID or the process restarts. Explicit stop, disconnect while a session is active, timeout, and process shutdown use the normal unregister path, but sandbox directories are still not deleted.

The sandbox is not an operating-system security boundary. The shell runs as the server's OS user and can access whatever that account can access. A changed working directory, minimal child environment, path validation, and symlink checks do not provide container, namespace, syscall, network, CPU, or memory isolation. Do not enable the terminal for untrusted or multi-tenant workloads without an external isolation system. At minimum, run the server as a dedicated unprivileged account with no host secrets or infrastructure credentials accessible to that account.

## Database, migrations, and retention

The Prisma schema is in `prisma/schema.prisma`; committed migrations are in `prisma/migrations/`.

- Use `npm run db:migrate` only for local migration development.
- Apply committed migrations in a release step with `npx prisma migrate deploy`.
- Run `npm run db:generate` after schema changes and before compiling against a newly installed client.
- Back up PostgreSQL independently. Redis Pub/Sub and counters are coordination state, not a backup.

The primary models are `User`, `Session`, `PasswordResetToken`, `Workspace`, `WorkspaceMember`, `Invite`, `Document`, `DocumentVersion`, `DocumentUpdate`, and `Snapshot`. Workspace paths are unique per workspace. Cascades remove dependent workspace and user data as defined in the Prisma schema.

There is no scheduled retention job for expired or revoked `Session` rows, used or expired `PasswordResetToken` rows, or expired invite rows. These records remain until their parent is deleted or an operator-provided cleanup process removes them. Add a reviewed retention job if storage, privacy, or regulatory requirements demand bounded history.

## Testing

Unit tests do not require PostgreSQL or Redis:

```bash
npm test
```

HTTP integration tests boot the real `AppModule` under Supertest and use the configured database. Start and migrate disposable infrastructure first:

```bash
npm run infra:up
npm run db:migrate
npm run test:integration
```

The integration suite creates prefixed synthetic accounts and removes them afterward. Use a disposable test database despite that cleanup boundary. Browser end-to-end tests live in the client package; see the [client test documentation](../client/README.md).

CI uses PostgreSQL 16, Redis 7, Node.js 22, `prisma migrate deploy`, serial
HTTP integration tests, and Playwright against one server process. Unit tests
cover the Redis and persistence services with mocks, but CI does not start
multiple application processes or verify PostgreSQL advisory locking against a
real concurrent replica pair, restore, Redis outage behavior, or terminal
Pub/Sub ordering. Redis being present in CI is not evidence that the unsupported
multi-replica topology is safe.

### E2E-only server mode

`E2E_TEST=true` raises configured HTTP and editor-event rate limits and enables two Swagger-hidden helper endpoints:

- `POST /e2e/cleanup` with an allow-listed synthetic email prefix
- `POST /auth/e2e/password-reset-token` with an allow-listed synthetic `@example.com` address

The cleanup operation removes matching test-owned workspaces and users in one transaction. The reset helper returns a raw reset token. Both routes return 404 when test mode is disabled or production is active, and startup rejects `E2E_TEST=true` with `NODE_ENV=production`.

The helper routes have no separate caller authentication. Prefix and domain validation limit their database scope, but an E2E-enabled server must be isolated from untrusted networks and must never share a database with production.

## Production checklist

1. Deploy one server process unless the multi-replica consistency gaps described above have been fixed and validated.
2. Install from the lockfile, generate Prisma Client, build, and apply committed migrations with `npx prisma migrate deploy` in a release job.
3. Set `NODE_ENV=production`, a high-entropy `JWT_SECRET`, `DATABASE_URL`, the exact `CLIENT_ORIGIN`, and working mail configuration. Set and monitor Redis only if its coordination features are required.
4. Terminate HTTPS at a trusted ingress. Configure WebSocket and Socket.IO transport handling, request-size and timeout limits, authoritative distributed rate limits, and an explicit trusted-proxy policy.
5. Restrict or disable public Swagger. Restrict PostgreSQL, Redis, logs, backups, and temporary storage according to their sensitivity.
6. Keep `E2E_TEST=false`. Keep `ENABLE_TERMINAL=false` unless an external isolation boundary and resource controls are in place.
7. Give the process enough termination grace to flush pending Yjs writes. Alert on PostgreSQL readiness, Redis state, persistence and compaction errors, mail failures, export memory pressure, and terminal resource use.
8. Keep `FORGOT_PASSWORD_TTL_MINUTES=30` until email template text is configuration-driven.
9. Define retention and cleanup procedures for sessions, reset tokens, invites, terminal files, and logs.
10. Back up PostgreSQL and test restoration procedures.

Invite and password-reset URLs are bearer credentials. They can appear in browser history, referrer data, and request logs. Limit access and retention, avoid forwarding full sensitive URLs to analytics, and expire or replace exposed links where the implementation permits it.
