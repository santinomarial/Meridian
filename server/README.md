# Meridian Server

NestJS + TypeScript backend for the Meridian collaborative browser IDE. Provides REST endpoints for workspace/document management, a Socket.IO gateway for real-time Yjs collaboration, PostgreSQL persistence via Prisma, and optional Redis cross-instance fan-out.

---

## Prerequisites

- Node.js 22+
- Docker (PostgreSQL and Redis via Docker Compose)

---

## Setup

```bash
npm install
cp .env.example .env        # Set JWT_SECRET to a random 16+ character string
npm run infra:up            # Start PostgreSQL and Redis via Docker Compose
npm run db:migrate          # Apply Prisma schema migrations
npm run db:seed             # Seed demo workspace and user
npm run start:dev           # Dev server with file watch → http://localhost:3000
```

Verify the server is running:

```
GET http://localhost:3000/health   → 200 { "status": "ok", ... }
GET http://localhost:3000/ready    → 200 { "status": "ready", ... }
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment (`development` / `production`) |
| `PORT` | `3000` | HTTP and WebSocket listen port |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS origin for browser requests and Socket.IO |
| `DATABASE_URL` | (see `.env.example`) | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | — | **Required** — secret used to sign and verify JWTs |
| `JWT_EXPIRES_IN` | `15m` | JWT lifetime (parsed by `@nestjs/jwt`) |
| `LOG_LEVEL` | `info` | Pino log level (`debug` / `info` / `warn` / `error`) |
| `DOC_TEARDOWN_GRACE_MS` | `30000` | Milliseconds before an in-memory Y.Doc is destroyed after the last client leaves |
| `SNAPSHOT_EVERY_N_UPDATES` | `100` | Number of Yjs updates that trigger a snapshot compaction |
| `HTTP_TTL_SECONDS` | `60` | Default HTTP throttler window (seconds) |
| `HTTP_LIMIT` | `120` | Max requests per window for the default throttler |
| `AUTH_TTL_SECONDS` | `60` | Auth throttler window (seconds) |
| `AUTH_LIMIT` | `10` | Max requests per window for auth endpoints |
| `WS_MESSAGE_LIMIT_PER_SECOND` | `50` | Max WebSocket messages per socket per second |
| `WS_MAX_YJS_UPDATE_BYTES` | `1048576` | Max accepted size (bytes) of a single Yjs update payload (1 MB) |

---

## Commands

| Command | Description |
|---|---|
| `npm run start:dev` | Start dev server with file watch |
| `npm run start:prod` | Run compiled output (`dist/main.js`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate` | Create and apply a new Prisma migration |
| `npm run db:studio` | Open Prisma Studio at `http://localhost:5555` |
| `npm run db:seed` | Seed demo workspace, folders, files, and user |
| `npm run infra:up` | Start PostgreSQL and Redis via Docker Compose |
| `npm run infra:down` | Stop Docker services |
| `npm test` | Run Jest unit test suite |

---

## Health and readiness probes

```
GET /health
```
Liveness probe. Always returns `200 OK` if the Node.js process is running.

```json
{
  "status": "ok",
  "service": "meridian-server",
  "uptime": 42.3,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

```
GET /ready
```
Readiness probe. Returns `200` when PostgreSQL is reachable; returns `503` otherwise. Redis availability is reported but does **not** affect the ready/not-ready decision.

```json
{
  "status": "ready",
  "dependencies": {
    "postgres": "ok",
    "redis": "ok"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Both probes are exempt from the strict `auth` throttler but are still governed by the `default` throttler.

---

## API reference

Auto-generated Swagger / OpenAPI documentation is available at:

```
http://localhost:3000/docs
```

### REST endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | No | Create account; sets `auth_token` cookie |
| `POST` | `/auth/login` | No | Authenticate; sets `auth_token` cookie |
| `POST` | `/auth/logout` | Yes | Revoke session; clears cookie |
| `GET` | `/auth/me` | Yes | Return current authenticated user |
| `GET` | `/users/:id` | Yes | Get user profile |
| `GET` | `/workspaces` | Yes | List workspaces for current user |
| `GET` | `/workspaces/:id` | Yes | Get workspace details |
| `GET` | `/workspaces/:id/documents` | Yes | List all documents in workspace |
| `GET` | `/workspaces/:id/documents/tree` | Yes | Document tree (nested, with content) |
| `GET` | `/documents/:id` | Yes | Get single document |
| `PATCH` | `/documents/:id` | Yes | Update document (name, content, language) |

---

## Database

### Schema overview

Managed by Prisma. Migration files live in `prisma/migrations/`.

| Model | Description |
|---|---|
| `User` | Account record; holds argon2id `passwordHash` |
| `Workspace` | Named container for documents; owned by one `User` |
| `WorkspaceMember` | Join table with `OWNER / EDITOR / VIEWER` role |
| `Document` | File or folder node; self-referential parent/child tree |
| `DocumentUpdate` | Append-only binary Yjs update row (sequential `seq` per document) |
| `Snapshot` | Compacted full Y.Doc state at a specific `seq` |
| `Session` | JWT session record with `jti`, `expiresAt`, and `revokedAt` |

### Migrations

```bash
# Create and apply a new migration interactively
npm run db:migrate

# Regenerate the Prisma client after schema changes
npm run db:generate

# Inspect the database in a browser UI
npm run db:studio
```

---

## Authentication

**Registration and login** use argon2id (argon2id variant) for password hashing.

**Session management** is database-backed. Every login creates a `Session` row with:
- `jti` — a UUID that is embedded in the JWT as the token ID claim.
- `expiresAt` — derived from the JWT `exp` claim so the row and the token always agree.
- `revokedAt` — set on logout; guarded handlers reject tokens where this field is non-null.

**Token delivery** uses an httpOnly cookie named `auth_token` (`SameSite=Lax`, `Secure` in production). The Socket.IO auth middleware accepts the token from `socket.handshake.auth.token` or the `auth_token` cookie header.

**Timing safety:** The login path always calls `argon2.verify` even when the email does not exist (using a dummy hash), preventing email enumeration via timing differences.

---

## Realtime gateway

The `EditorGateway` (`@WebSocketGateway`) handles all Socket.IO connections.

### Socket events

| Direction | Event | Description |
|---|---|---|
| Client → Server | `joinDocument` | Join document room; receive Yjs sync step 1 and current awareness state |
| Client → Server | `leaveDocument` | Leave document room; awareness states cleared and broadcast |
| Client → Server | `yjs:update` | Binary Yjs delta; applied to Y.Doc; relayed to room; persisted; published to Redis |
| Client → Server | `yjs:sync` | Yjs sync protocol message; server responds with step 2 if state vector differs |
| Client → Server | `awareness:update` | Binary awareness state (cursor/selection); relayed to room; published to Redis |
| Server → Client | `yjs:sync` | Sync step 1 sent on join; step 2 responses |
| Server → Client | `yjs:update` | Relayed Yjs update from another client in the same room |
| Server → Client | `awareness:update` | Relayed awareness update from another client |
| Server → Client | `userJoined` | Another user joined the document room |
| Server → Client | `userLeft` | Another user left or disconnected |
| Server → Client | `joinedDocument` | Confirmation of successful room join |
| Server → Client | `error` | Validation or authorization error |

### Authorization

Every `joinDocument` event checks workspace membership:
```
WorkspacesService.canUserAccessDocument(userId, documentId)
```
If the check fails, an `error` event is emitted and the join is rejected without leaking document existence.

### Rate limiting

- **Per-socket message rate:** `WsRateLimiter` enforces a fixed 1-second window. Messages exceeding `WS_MESSAGE_LIMIT_PER_SECOND` (default 50) are dropped and an `error` event is emitted.
- **Payload size:** Yjs updates exceeding `WS_MAX_YJS_UPDATE_BYTES` (default 1 MB) are rejected before any processing.

---

## Yjs persistence

### Write path

Each `yjs:update` event triggers:
1. `DocumentManagerService.applyUpdate` — applied immediately to the authoritative in-memory Y.Doc.
2. Room relay — `client.to(room).emit("yjs:update")` sends to all peers; the sender is excluded.
3. `DocumentPersistenceService.persistUpdate` — enqueued in a per-document promise chain; returns immediately so relay is not blocked by I/O.
4. Redis publish — `PUBLISH document:{id}:updates` for cross-instance fan-out.

### Sequence numbers

Sequence numbers are maintained in-memory (`Map<documentId, number>`) and initialized from the database high-water mark on first write. This avoids a database round-trip per update. Writes for the same document are serialized through the promise chain so monotonicity is guaranteed in a single-process deployment.

### Snapshot compaction

Every `SNAPSHOT_EVERY_N_UPDATES` persisted updates (default 100):
1. The current Y.Doc state is encoded with `Y.encodeStateAsUpdate`.
2. A `Snapshot` row is inserted with the current `seq` as its key.
3. All `DocumentUpdate` rows with `seq <= snapshot.seq` are deleted.
4. Steps 2 and 3 run in a single PostgreSQL transaction — a concurrent cold load will see either all old update rows or the new snapshot, never a gap.

### Cold load

When `DocumentManagerService.acquire(documentId)` is called for a document not currently in memory:
1. Load the latest `Snapshot` row (if any).
2. Apply it to a new `Y.Doc` with `Y.applyUpdate`.
3. Load all `DocumentUpdate` rows with `seq > snapshot.seq`, ordered by `seq ASC`.
4. Apply each delta in sequence.
5. Return the reconstructed Y.Doc.

### Document lifecycle

`DocumentManagerService` is ref-counted:
- `acquire()` increments the ref count (or loads from DB if not present).
- `release()` decrements the ref count. When it reaches zero, a teardown timer (`DOC_TEARDOWN_GRACE_MS`, default 30 s) is set.
- If a client re-joins before the timer fires, the timer is cancelled and the Y.Doc stays warm.
- After the timer fires, the Y.Doc and its Awareness are destroyed and removed from the in-memory map.

---

## Redis cross-instance scaling

`RedisService` manages two `ioredis` clients:
- **Publisher** — used for `PUBLISH` commands.
- **Subscriber** — registered with `PSUBSCRIBE`; a dedicated connection is required because a subscribed client cannot issue other commands.

The gateway subscribes to:
- `document:*:updates` — Yjs binary updates from other instances.
- `document:*:awareness` — awareness states from other instances.

Every outbound Redis message includes `originId` — a UUID generated once at process startup (`origin.ts`). On receiving a message from Redis, instances discard it if `originId` matches their own, preventing self-echo and double-apply.

**Startup behavior:** `RedisService` uses `lazyConnect: true` and a 3-second connection timeout. If Redis is unreachable, `isAvailable` is set to `false` and all Redis calls are no-ops. The server continues to operate in single-instance mode with no pub/sub fan-out.

---

## Tests

```bash
npm test
```

Unit tests use **Jest** with **`jest-mock-extended`** for dependency mocking. Every `*.service.ts`, `*.gateway.ts`, and `*.guard.ts` has a corresponding `*.spec.ts` file in the same directory.

Test files run in `node` environment (no browser globals). Coverage is collected from all `src/**/*.ts` files.
