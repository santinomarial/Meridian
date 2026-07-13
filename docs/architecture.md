# Meridian Architecture

---

## 1. Architecture goals

Meridian is designed to demonstrate a complete, production-minded engineering story from browser to database:

| Goal | How it is addressed |
|---|---|
| Polished developer-tool frontend | React + Monaco editor, Tailwind design system, Zustand state, responsive IDE layout |
| TypeScript end-to-end | Shared idioms and strict compiler settings across client and server |
| Real-time collaboration | Socket.IO document rooms, Yjs CRDT binary update protocol |
| CRDT-based convergence | Yjs — each client and the server converge on the same document state without a central transform step |
| Durable persistence | PostgreSQL via Prisma; append-only Yjs update log; periodic snapshot compaction |
| Horizontal scaling | Redis pub/sub fan-out with per-process `originId` to prevent double-apply and self-echo |
| Production-minded backend | NestJS modules with clear boundaries; rate limiting; request tracing; structured logging; health and readiness probes; Swagger docs |

---

## 2. System context

```mermaid
flowchart LR
    User(["Engineer"])

    Client["Meridian Web Client\n(Browser)"]

    Server["Meridian API Server\n(NestJS · :3000)"]

    PG[("PostgreSQL")]

    Redis[("Redis")]

    User -->|"navigates"| Client
    Client -->|"HTTPS / REST"| Server
    Server -->|"Socket.IO / WebSocket"| Client
    Server -->|"Prisma ORM queries"| PG
    Server -->|"PUBLISH / PSUBSCRIBE"| Redis
```

**What this shows:** The engineer interacts with the browser client over HTTPS. The browser communicates with a single API server over both REST (for CRUD) and WebSocket (for live collaboration). The server persists data to PostgreSQL and coordinates with Redis for cross-instance message fan-out.

---

## 3. Container diagram

```mermaid
flowchart LR
    subgraph Browser["Browser — Web Client"]
        ReactUI["React Workspace UI\n(Zustand · Router)"]
        Monaco["Monaco Editor\n(y-monaco CRDT binding)"]
        APIClient["API Client\n(typed fetch helpers)"]
        YjsSocket["Yjs + Socket.IO Client\n(socket.io-client · y-protocols)"]
    end

    subgraph Server["API Server — NestJS :3000"]
        REST["REST Controllers\nAuth · Users · Workspaces · Documents"]
        GW["EditorGateway\n(Socket.IO)"]
        DocMgr["DocumentManagerService\n(in-memory Y.Doc + Awareness)"]
        Persist["DocumentPersistenceService\n(write chain · compaction)"]
        RedisSvc["RedisService\n(PUBLISH · PSUBSCRIBE)"]
        PrismaSvc["PrismaService\n(Prisma ORM)"]
    end

    PG[("PostgreSQL")]
    RD[("Redis")]
    OtherSrv["Other Server Instance(s)"]

    ReactUI -->|"user action"| APIClient
    ReactUI -->|"edit"| Monaco
    Monaco -->|"Yjs binary update"| YjsSocket
    APIClient -->|"HTTPS REST"| REST
    YjsSocket -->|"Socket.IO / WSS"| GW
    REST -->|"typed query / mutation"| PrismaSvc
    PrismaSvc -->|"Prisma ORM"| PG
    GW -->|"acquire · applyUpdate"| DocMgr
    DocMgr -->|"persistUpdate"| Persist
    Persist -->|"INSERT DocumentUpdate\nINSERT Snapshot"| PrismaSvc
    GW -->|"PUBLISH update"| RedisSvc
    RedisSvc -->|"PUBLISH"| RD
    RD -.->|"PSUBSCRIBE fan-out"| OtherSrv
```

**What this shows:** The browser container contains the React UI, Monaco editor (bound to Yjs via `y-monaco`), a typed API client for REST calls, and a Socket.IO/Yjs client for realtime events. The server container handles both HTTP and WebSocket traffic through separate pipelines that share the Prisma layer. Redis is optional: if unavailable, the server continues in single-instance mode.

---

## 4. Backend component diagrams

### 4a. HTTP pipeline

Every HTTP request flows through a global middleware and guard chain before reaching a controller.

```mermaid
flowchart TD
    Req["Incoming HTTP Request"]
    RIM["RequestIdMiddleware\n(injects X-Request-Id header)"]
    TG["ThrottlerGuard\ndefault: 120 req / 60 s\nauth routes: 10 req / 60 s"]
    Guard["JwtAuthGuard\n(validates JWT cookie or Bearer token\non guarded routes)"]

    subgraph Controllers["Controllers"]
        Auth["AuthController\n/auth/register · /auth/login · /auth/logout · /auth/me"]
        Users["UsersController\n/users"]
        Workspaces["WorkspacesController\n/workspaces"]
        Documents["DocumentsController\n/documents"]
    end

    subgraph Services["Services"]
        AuthSvc["AuthService\n(argon2id · JWT signing · Session rows)"]
        UsersSvc["UsersService"]
        WSSvc["WorkspacesService"]
        DocsSvc["DocumentsService"]
    end

    PrismaSvc["PrismaService"]
    HEF["HttpExceptionFilter\n(all thrown exceptions → structured JSON)"]
    PG[("PostgreSQL")]

    Req --> RIM --> TG --> Guard --> Controllers
    Auth --> AuthSvc
    Users --> UsersSvc
    Workspaces --> WSSvc
    Documents --> DocsSvc
    AuthSvc & UsersSvc & WSSvc & DocsSvc --> PrismaSvc --> PG
    HEF -.->|"catches all exceptions"| Controllers
```

### 4b. WebSocket / realtime pipeline

Socket.IO connections are authenticated in the `afterInit` middleware before `handleConnection` fires. All events are rate-limited per socket.

```mermaid
flowchart TD
    Connect["Socket.IO Connection\n(JWT auth middleware — auth failure rejects handshake)"]
    GW["EditorGateway\n(@WebSocketGateway)"]
    RL["WsRateLimiter\n(50 msg / s per socket · fixed window)"]
    CR["ConnectionRegistryService\n(socketId → documentId Set)"]

    subgraph DocLife["Document lifecycle"]
        DM["DocumentManagerService\n(Y.Doc + Awareness per document)\n(ref-counted · grace-period teardown)"]
        PS["DocumentPersistenceService\n(per-doc promise chain)\n(snapshot compaction every N updates)"]
    end

    PrismaSvc["PrismaService"]
    RS["RedisService\n(separate publisher + subscriber ioredis clients)"]
    PG[("PostgreSQL")]
    RD[("Redis")]

    Connect -->|"handleConnection"| GW
    GW --> RL
    GW -->|"register · join · leave · disconnect"| CR
    GW -->|"acquire · applyUpdate · release"| DM
    DM -->|"persistUpdate (async, non-blocking)"| PS
    PS -->|"INSERT DocumentUpdate\nINSERT Snapshot (transactional)"| PrismaSvc
    PrismaSvc --> PG
    GW -->|"PUBLISH Yjs update\nPUBLISH awareness state"| RS
    RS -->|"PSUBSCRIBE fan-out"| RD
```

---

## 5. Realtime editing runtime flow

This sequence shows the hot path for a single Yjs update from one editing client to a peer in the same document room.

```mermaid
sequenceDiagram
    participant CA as Client A (editor)
    participant GW as EditorGateway
    participant DM as DocumentManagerService
    participant CB as Client B (peer)
    participant PS as PersistenceService
    participant PG as PostgreSQL
    participant RD as Redis

    CA->>GW: yjs:update { documentId, update: Uint8Array }
    Note over GW: rate-limit check<br/>payload-size check (≤ 1 MB)
    GW->>DM: applyUpdate(documentId, update)
    Note over DM: Y.applyUpdate(doc, update)
    GW->>CB: yjs:update { documentId, update }
    Note over GW,CB: client.to(room) — sender excluded (no echo)
    CB->>CB: Y.applyUpdate(doc, update, "remote")
    GW->>PS: persistUpdate(documentId, update)
    Note over PS: enqueued in per-doc promise chain<br/>returns immediately — relay is not blocked
    PS->>PG: INSERT DocumentUpdate (seq, binary)
    Note over PS: every SNAPSHOT_EVERY_N updates →<br/>INSERT Snapshot + DELETE old updates (transaction)
    GW->>RD: PUBLISH document:{id}:updates { originId, update: base64 }
    Note over RD: other server instances receive via PSUBSCRIBE
```

**Key design choices:**
- `client.to(room)` sends to all room members **except** the sender — the originating client already applied its own update locally through Yjs.
- Persistence is enqueued asynchronously; the relay to peers is never blocked by a database write.
- Each write is serialized per document through a promise chain to keep sequence numbers monotonic.

---

## 6. Cross-instance scaling flow

When multiple server instances are running, Redis pub/sub fans out Yjs updates and awareness states between instances. Each instance carries a stable `ORIGIN_ID` (a UUID generated once at process startup) to prevent self-echo and double-apply.

```mermaid
sequenceDiagram
    participant CA as Client A
    participant SIA as Server Instance A
    participant RD as Redis
    participant SIB as Server Instance B
    participant CB as Client B

    CA->>SIA: yjs:update { documentId, update }
    SIA->>SIA: applyUpdate(doc, update)
    SIA->>CA: (no echo — sender excluded from room relay)
    SIA->>RD: PUBLISH document:{id}:updates<br/>{ originId: "uuid-A", update: base64 }
    RD->>SIA: pmessage (originId == own ORIGIN_ID → discard)
    RD->>SIB: pmessage document:{id}:updates
    Note over SIB: originId != own ORIGIN_ID → process
    SIB->>SIB: applyUpdate(doc, update)
    SIB->>CB: yjs:update { documentId, update }
    CB->>CB: Y.applyUpdate(doc, update, "remote")
```

**Why `originId` exists:**

| Problem | How `originId` solves it |
|---|---|
| Self-echo | Instance A receives its own Redis message and discards it (`originId == ORIGIN_ID`) |
| Double-apply | Instance A already applied the update locally before publishing; discarding the loopback prevents applying it twice |
| Clean separation | Local relay (`client.to(room)`) and cross-instance relay (Redis) are independent paths with no interaction |

Redis is configured with `lazyConnect: true` and `retryStrategy: () => null`. If Redis is unavailable at startup, the server logs a warning and continues in **single-instance mode** — all collaboration still works, just limited to one process.

---

## 7. Persistence and recovery

### 7a. Write path with compaction

```mermaid
flowchart TD
    Edit["Client keystroke in Monaco"]
    Update["yjs:update received by EditorGateway"]
    Apply["Y.applyUpdate on in-memory Y.Doc"]
    Relay["Relay to room members\n(other sockets, other instances via Redis)"]
    Queue["Enqueue write\n(per-document promise chain)"]
    Insert["INSERT DocumentUpdate\n(documentId, seq, binary update)"]
    Counter["Increment update counter\nfor this document"]
    Check{{"counter >= SNAPSHOT_EVERY_N?"}}
    Compact["Transaction:\nINSERT Snapshot (full Y.Doc state, seq)\nDELETE DocumentUpdate rows with seq <= snapshot.seq"]
    Done["Done"]

    Edit --> Update --> Apply
    Apply --> Relay
    Apply --> Queue
    Queue --> Insert --> Counter --> Check
    Check -->|"No"| Done
    Check -->|"Yes — reset counter"| Compact --> Done
```

### 7b. Cold load (document not in memory)

When a client joins a document not currently held in memory, `DocumentManagerService` reconstructs the authoritative Y.Doc from the database before sending Yjs sync step 1.

```mermaid
flowchart TD
    Join["Client sends joinDocument"]
    Acquire["DocumentManagerService.acquire(documentId)"]
    Exists{"Y.Doc already\nin memory?"}
    HotPath["Increment refCount\nCancel pending teardown timer\nReturn existing doc"]
    NewDoc["new Y.Doc()"]
    LoadSnap["SELECT latest Snapshot\n(ORDER BY seq DESC LIMIT 1)"]
    HasSnap{"Snapshot\nexists?"}
    ApplySnap["Y.applyUpdate(doc, snapshot.state)"]
    LoadUpdates["SELECT DocumentUpdate\nWHERE seq > snapshot.seq\nORDER BY seq ASC"]
    ApplyUpdates["Apply each update in order\n(replay delta since snapshot)"]
    Sync["Send Yjs Sync Step 1\nto joining client"]

    Join --> Acquire --> Exists
    Exists -->|"Yes"| HotPath --> Sync
    Exists -->|"No"| NewDoc --> LoadSnap --> HasSnap
    HasSnap -->|"Yes"| ApplySnap --> LoadUpdates
    HasSnap -->|"No"| LoadUpdates
    LoadUpdates --> ApplyUpdates --> Sync
```

**Persistence guarantees:**

| Storage layer | Durable? | What is stored |
|---|---|---|
| PostgreSQL `DocumentUpdate` | Yes | Append-only binary Yjs update log (sequential) |
| PostgreSQL `Snapshot` | Yes | Compacted Y.Doc state at a specific sequence number |
| PostgreSQL `Document.content` | Yes | Plain-text content updated on REST save (Cmd+S) |
| Redis | No application durability | Pub/sub messages, authorization invalidations, and atomic per-document sequence counters; never authoritative document state |
| In-memory Y.Doc | No | Hot working state; released after `DOC_TEARDOWN_GRACE_MS` with no clients |
| Awareness (cursors/selections) | No | Ephemeral; never written to the database |

---

## 8. Data model

```mermaid
erDiagram
    User {
        string id PK
        string email UK
        string passwordHash
        string displayName
        string avatarUrl
    }
    Workspace {
        string id PK
        string name
        string ownerId FK
    }
    WorkspaceMember {
        string id PK
        string workspaceId FK
        string userId FK
        string role
    }
    Document {
        string id PK
        string workspaceId FK
        string parentId FK
        string type
        string path
        string name
        string language
        string content
    }
    DocumentUpdate {
        string id PK
        string documentId FK
        bytes update
        int seq
    }
    Snapshot {
        string id PK
        string documentId FK
        bytes state
        int seq
    }
    Session {
        string id PK
        string userId FK
        string jti UK
        datetime expiresAt
        datetime revokedAt
    }
    Invite {
        string id PK
        string token UK
        string workspaceId FK
        string invitedById FK
        string email
        string role
        datetime expiresAt
        datetime acceptedAt
    }
    PasswordResetToken {
        string id PK
        string userId FK
        string tokenHash UK
        datetime expiresAt
        datetime usedAt
    }
    DocumentVersion {
        string id PK
        string documentId FK
        string workspaceId FK
        string createdById FK
        int versionNumber
        string content
        string message
        datetime createdAt
    }

    User ||--o{ Workspace : "owns"
    User ||--o{ WorkspaceMember : "member via"
    User ||--o{ Session : "authenticated via"
    User ||--o{ Invite : "sends"
    User ||--o{ PasswordResetToken : "resets with"
    User o|--o{ DocumentVersion : "authors"
    Workspace ||--o{ WorkspaceMember : "has"
    Workspace ||--o{ Document : "contains"
    Workspace ||--o{ Invite : "has"
    Workspace ||--o{ DocumentVersion : "indexes"
    Document o|--o{ Document : "parent of"
    Document ||--o{ DocumentUpdate : "logged in"
    Document ||--o{ Snapshot : "snapshotted in"
    Document ||--o{ DocumentVersion : "versioned in"
```

**Schema notes:**
- `WorkspaceMember.role` is an enum: `OWNER | EDITOR | VIEWER`. A user can only hold one membership per workspace (`UNIQUE(workspaceId, userId)`).
- `Document.type` is an enum: `FILE | FOLDER`. Documents form a recursive tree through the self-referential `parentId` relation; top-level documents have `parentId = null`.
- `Document.path` is unique within a workspace (`UNIQUE(workspaceId, path)`).
- `DocumentUpdate.seq` is unique per document (`UNIQUE(documentId, seq)`), indexed for efficient cold-load queries.
- `Session.jti` is the JWT ID claim — unique per token, used to revoke individual sessions without invalidating all tokens for a user.
- `Invite.token` is a random bearer token with a seven-day expiry. Invitations may optionally target an email address and become workspace memberships when accepted.
- `PasswordResetToken` stores a token hash rather than the bearer token. Tokens expire and are marked used after a successful reset.
- `DocumentVersion.versionNumber` is unique per document. Versions contain plain text for history, diff, and restore independently of the Yjs update log.

---

## 9. CRDT / Yjs versus Operational Transformation

**Why not OT?**

Operational Transformation is a well-studied approach to collaborative editing. The core challenge is that when two clients make concurrent edits, each operation must be *transformed* against every concurrent operation so that all replicas converge. This transformation must account for every possible pair of operation types (insert/insert, insert/delete, delete/delete) and must be applied in exactly the right order. Implementing a correct OT engine from scratch is notoriously difficult; even established OT implementations (Google Wave, ShareDB) have had subtle correctness bugs.

**Why Yjs?**

Yjs is a production-hardened CRDT library used in commercial collaborative tools. CRDTs (Conflict-free Replicated Data Types) take a different approach: every operation is designed so that applying any set of operations in any order produces the same final state. There is no transformation step.

Concretely, Yjs assigns every character insertion a unique, stable identity derived from the client ID and a local clock. When two clients insert characters at the same position concurrently, Yjs uses deterministic tie-breaking rules to resolve the conflict — the same rules applied independently on every replica. The result is guaranteed to converge.

**What this means for Meridian:**

By using Yjs, Meridian can focus its engineering effort on the system integration layer — the parts that are genuinely complex and differentiating for a collaborative IDE:

- Binding Yjs to Monaco (`y-monaco` + `MonacoBinding`)
- Managing Yjs document rooms in Socket.IO
- Implementing the Yjs sync protocol (step 1 / step 2 handshake)
- Persisting the binary update log and compacting it with snapshots
- Fanning out updates across server instances via Redis
- Handling awareness (cursor positions and selections) ephemerally
- Reconnect and backfill behavior when a client rejoins

None of this required implementing a custom CRDT or OT engine.

---

## 10. Request / response paths

### REST path

```
Browser
  → API Client (typed fetch, HTTPS, credentials: "include")
  → NestJS Controller (class-validator DTOs, ValidationPipe)
  → Service (business logic)
  → PrismaService
  → PostgreSQL
```

### Realtime editing path

```
Monaco keypress
  → y-monaco MonacoBinding captures change
  → Y.Doc emits binary update
  → Socket.IO client sends yjs:update { documentId, update }
  → EditorGateway.handleYjsUpdate
  → DocumentManagerService.applyUpdate (in-memory Y.Doc)
  → client.to(room).emit("yjs:update") → peers apply update
  → DocumentPersistenceService.persistUpdate (async)
  → RedisService.publish (async)
```

### Persistence path

```
Yjs update received
  → DocumentPersistenceService enqueues write (promise chain)
  → INSERT DocumentUpdate (documentId, seq, binary)
  → every SNAPSHOT_EVERY_N updates:
      INSERT Snapshot (full Y.Doc state, seq)
      DELETE DocumentUpdate rows where seq <= snapshot.seq
      (single PostgreSQL transaction)
```

### Presence / awareness path

```
Monaco cursor move or selection change
  → Yjs Awareness API encodes state as binary update
  → Socket.IO client sends awareness:update { documentId, update }
  → EditorGateway.handleAwarenessUpdate
  → awarenessProtocol.applyAwarenessUpdate (in-memory Awareness)
  → client.to(room).emit("awareness:update") → peers update cursors
  → RedisService.publish (cross-instance fan-out, if Redis is available)
  [awareness states are NOT written to PostgreSQL]
```

### Auth path

```
Register:
  Browser form → POST /auth/register
  → AuthService: check unique email → argon2id.hash(password)
  → prisma.user.create + prisma.session.create
  → JWT signed with { sub, email, jti } → set as httpOnly cookie "auth_token"

Login:
  Browser form → POST /auth/login
  → AuthService: prisma.user.findUnique
  → argon2id.verify (runs even when user not found — prevents email enumeration)
  → prisma.session.create → JWT → httpOnly cookie

Guarded request:
  → JwtAuthGuard: extracts JWT from cookie or Bearer header
  → jwtService.verify → prisma.session.findUnique (checks expiry + revokedAt)
  → socket.data.user / req.user set for downstream handlers

Logout:
  → POST /auth/logout → prisma.session.update { revokedAt: now }
  → cookie cleared
```

---

## 11. Production deployment architecture

> **Status: PLANNED — Meridian is not yet deployed to production. The diagram below shows the intended architecture.**

```mermaid
flowchart TD
    Browser["Browser"]
    DNS["DNS / Domain"]
    CDN["CDN\n(static frontend hosting)"]
    LB["Load Balancer\n(HTTPS · TLS termination · WSS upgrade)"]

    subgraph AppTier["API Server Tier (horizontally scalable)"]
        SIA["Server Instance A\n(NestJS :3000)"]
        SIB["Server Instance B\n(NestJS :3000)"]
    end

    PG[("Managed PostgreSQL\n(SSL connection)")]
    RD[("Managed Redis\n(TLS connection)")]
    Secrets["Secrets / Environment Config\nJWT_SECRET · DATABASE_URL\nREDIS_URL · CLIENT_ORIGIN"]

    Browser -->|"HTTPS"| DNS
    DNS -->|"HTTPS (static assets)"| CDN
    CDN -->|"cached assets"| Browser
    DNS -->|"HTTPS / WSS"| LB
    LB -->|"HTTP · WS"| SIA
    LB -->|"HTTP · WS"| SIB
    SIA -->|"Prisma + TLS"| PG
    SIB -->|"Prisma + TLS"| PG
    SIA -->|"PUBLISH / PSUBSCRIBE"| RD
    SIB -->|"PUBLISH / PSUBSCRIBE"| RD
    Secrets -.->|"injected at startup"| SIA
    Secrets -.->|"injected at startup"| SIB
```

**Scaling notes:**
- The load balancer must support WebSocket upgrades and sticky Socket.IO connections. Redis distributes cross-instance events, but each live socket and room membership remains owned by the instance that accepted it.
- Each server instance keeps active Yjs documents, socket state, rate limits, and terminal processes in memory. Horizontal scale-out requires shared PostgreSQL and Redis plus sticky WebSocket routing.
- The frontend is fully static (Vite build output) and can be served from any CDN without server-side rendering.

---

## 12. Operational concerns

### Health and readiness

| Endpoint | Purpose | Success criteria |
|---|---|---|
| `GET /health` | Liveness probe — is the process up? | Always `200 OK` if the process is running |
| `GET /ready` | Readiness probe — can the process serve traffic? | `200 OK` if PostgreSQL is reachable; `503` otherwise |

The readiness response includes both `postgres` and `redis` dependency statuses. Redis being unavailable reports `"disabled"` but does **not** cause a `503` — the server is still ready to serve traffic in single-instance mode.

### Structured logging

Pino is used via `nestjs-pino`. In `development` mode logs are pretty-printed; in `production` mode they are emitted as JSON. Every log line carries the request ID and any other structured fields added by the handler. Log level is configurable via `LOG_LEVEL`.

### Request tracing

`RequestIdMiddleware` runs on every HTTP route. It reads the incoming `X-Request-Id` header (from a gateway or load balancer) or generates a new UUID v4 if none is present, then sets it on the request and response. The `HttpExceptionFilter` includes the request ID in all error responses for correlation.

### Input validation

A global `ValidationPipe` (whitelist mode, `forbidNonWhitelisted: true`, `transform: true`) is applied to all HTTP handlers. Socket.IO event handlers have their own `ValidationPipe` instance via `@UsePipes` on the gateway. DTOs use `class-validator` decorators; unexpected fields are stripped or rejected.

### Error handling

`HttpExceptionFilter` catches all `HttpException` subclasses thrown from controllers and returns a consistent JSON body `{ statusCode, message, requestId, path, timestamp }`. WebSocket validation errors are caught by `WsValidationFilter` and emitted back to the client as an `error` event.

### Rate limiting

**HTTP:** Two named throttlers via `@nestjs/throttler`:
- `default` — 120 requests per 60 seconds, applied to all endpoints.
- `auth` — 10 requests per 60 seconds, applied to `AuthController`. Non-auth controllers opt out with `@SkipThrottle({ auth: true })`.

**WebSocket:** `WsRateLimiter` enforces a fixed-window per-socket limit of `WS_MESSAGE_LIMIT_PER_SECOND` (default 50 messages/second). Messages exceeding the limit are dropped and an `error` event is emitted to the socket.

### Payload caps

Yjs update payloads larger than `WS_MAX_YJS_UPDATE_BYTES` (default 1 MB) are rejected by the gateway before any processing. An `error` event is emitted to the sending socket.

### Graceful shutdown

The server enables NestJS shutdown hooks. On application shutdown, pending Yjs
write chains are drained before exit; Prisma and Redis connections are closed;
realtime timers and subscriptions are released; and active terminal processes
are terminated. The deployment platform must still allow enough termination
grace time for these hooks to complete.

### Database migrations

Prisma manages the migration history. New migrations are created with `npm run db:migrate` (which runs `prisma migrate dev`). The `prisma/migrations/` directory is committed to version control.

### Redis optional fallback

Redis is non-mandatory at startup. `RedisService` attempts to connect with a 3-second timeout per client. On failure it sets `isAvailable = false` and the server continues with no pub/sub — all collaboration works within a single instance. There is no automatic reconnection; a process restart is required to re-enable Redis.

---

## 13. Local development reference

```bash
# ── Infrastructure ───────────────────────────────────────────────
cd server
npm run infra:up          # Start PostgreSQL (:5432) and Redis (:6379) via Docker

# ── Database ─────────────────────────────────────────────────────
npm run db:migrate        # Apply all pending Prisma migrations
npm run db:seed           # Seed demo workspace, folders, files, and user
npm run db:studio         # Open Prisma Studio at http://localhost:5555

# ── Server ───────────────────────────────────────────────────────
npm run start:dev         # Dev server with watch → http://localhost:3000
npm run build             # Compile TypeScript output to dist/
npm run start:prod        # Run compiled output

# ── Tests ────────────────────────────────────────────────────────
npm test                  # Run Jest unit tests (src/**/*.spec.ts)

# ── Client ───────────────────────────────────────────────────────
cd ../client
npm run dev               # Vite dev server → http://localhost:5173
npm run build             # Production build to dist/
```

**Minimum required env vars for local development (see `server/.env.example`):**

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/meridian?schema=public"
REDIS_URL=redis://localhost:6379
JWT_SECRET=any-random-string-at-least-16-chars
```
