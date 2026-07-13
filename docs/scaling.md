# Horizontal scaling and failure model

This document defines the current multi-replica behavior of the Meridian API
server. It covers the coordination paths that use PostgreSQL and Redis, the
state that remains local to each process, and the failure modes an operator must
account for. For component setup and configuration, see the
[server guide](../server/README.md). For the logical component layout, see the
[architecture overview](architecture.md).

## Current support boundary

Shared PostgreSQL, shared Redis, and Socket.IO session affinity are required for
more than one API replica, but they are not sufficient to make every workflow
cross-replica safe.

Even with healthy dependencies, the current implementation has two primary
data-integrity limitations:

1. Yjs sequence allocation is global, but PostgreSQL writes and compaction are
   serialized only within each API process. A lower sequence can be inserted
   after another replica has compacted through a higher sequence, causing the
   late update to be skipped on a future cold load.
2. Version restore changes and CRDT history resets are coordinated only on the
   replica that handles the HTTP request. Other replicas with the document open
   are not notified or fenced from writing stale state.

For workloads that require durable collaborative editing or version restore,
run one API replica until those limitations are corrected. Multiple replicas
can distribute ordinary HTTP work and provide best-effort realtime fan-out, but
the complete API tier should not currently be treated as generally safe for
horizontal collaborative editing.

| Area | Current classification |
|---|---|
| HTTP authentication and CRUD | Shared PostgreSQL state; suitable for multiple replicas, subject to per-process throttling |
| Live Yjs relay | Best effort through Redis Pub/Sub while Redis and all subscriptions are healthy |
| Yjs persistence and compaction | Not safe for general multi-replica use; see the sequence race below |
| Version restore | Single-replica only |
| Awareness and workspace chat | Ephemeral, best effort, and not replayed |
| Session and membership revocation | Redis invalidation fast path plus PostgreSQL rechecks and periodic audits |
| Terminal PTY | Local to one process and one socket |
| Terminal sandbox projection | Best-effort Redis fan-out with no replay or global operation ordering |
| HTTP rate limiting | In-memory and per process |
| Editor/chat gateway rate limiting | In-memory and per socket; terminal events are not covered |

## Required topology

All replicas must run the same application build, database schema, and security
configuration. At minimum, a multi-replica deployment requires:

- one shared PostgreSQL database;
- one shared Redis deployment that is healthy before any API replica starts;
- identical JWT, origin, feature-flag, and runtime-limit configuration;
- affinity for the entire Socket.IO session; and
- enough PostgreSQL and Redis capacity for the aggregate connection and message
  load from every replica.

```text
Browser clients
      |
      | HTTP and Socket.IO
      v
Load balancer
      |-- HTTP routes: any healthy API replica
      `-- /socket.io/: one replica for handshake, polling, upgrade, and session
              |-- API replica A --+
              |-- API replica B --+--> shared PostgreSQL
              `-- API replica C --+--> shared Redis
```

The client permits both WebSocket and HTTP long-polling transports. Affinity
must therefore cover the initial Socket.IO handshake, every polling request,
the transport upgrade, and the remaining connection lifetime. Affinity only
after a WebSocket upgrade is not sufficient. Ordinary HTTP requests do not
require affinity because guarded requests validate their JWT and backing
`Session` row against shared PostgreSQL.

Meridian does not install the Socket.IO Redis adapter. Socket.IO rooms and
socket objects remain process-local. The application explicitly publishes the
selected update, awareness, chat, authorization, and sandbox messages described
below.

Redis is a trusted internal boundary. Collaboration, chat, and sandbox
subscribers do not independently authenticate or authorize every inbound Redis
message against PostgreSQL. Keep Redis private, require appropriate
authentication and transport protection, and do not share it with untrusted
publishers. The channel names have no configurable environment prefix. Do not
share one Redis Pub/Sub deployment across production, staging, or unrelated
Meridian installations; Redis logical database numbers do not isolate Pub/Sub
channels.

## State ownership

| State | Owner | Cross-replica behavior |
|---|---|---|
| Users, sessions, workspaces, memberships, invites, saved documents, versions, Yjs updates, and snapshots | PostgreSQL | Shared and durable |
| Open `Y.Doc` and awareness state | Each API process | Duplicated when the same document is open on multiple replicas |
| Socket.IO sockets and room membership | Each API process | Not shared; selected events are relayed manually through Redis |
| Document sequence counter | Redis when available | Atomic per document while Redis is healthy |
| Yjs persistence queue | Each API process | Per-document promise chain; not coordinated with other processes |
| Authorization cache | Each API process | One-second cache; invalidated locally and through Redis |
| HTTP throttle counters | Each API process | No shared global budget |
| Editor/chat throttle counters | Each API process, keyed by socket ID | One fixed one-second budget per socket |
| Terminal process and sandbox directory | One API process | Cannot migrate; a new session materializes saved database content |

## HTTP and authorization behavior

Guarded HTTP requests verify the JWT and load the exact PostgreSQL `Session`
identified by its JTI. Logout and password reset revoke session rows in
PostgreSQL, so subsequent guarded requests are rejected regardless of which
replica receives them.

Connected sockets need additional enforcement because a JWT may remain
cryptographically valid after its database session or workspace access changes.
The editor and terminal gateways use the following controls:

- protected events recheck the database-backed session and current workspace
  role, with successful results cached for at most one second;
- logout, password reset, account deletion, membership changes, and workspace
  deletion deliver local invalidations and publish them on
  `realtime:authorization:invalidate`; and
- editor and terminal gateways force a database audit on a 10-second interval.

Redis invalidation normally removes passive sockets promptly across replicas.
If an invalidation message is missed, a protected event may use cached access
for up to one second, and a passive socket is checked on the next periodic
audit. The 10-second interval is an audit cadence, not a hard revocation SLA;
database latency and the time required to scan connected clients can extend it.

## Realtime fan-out

### Yjs document updates

For an accepted `yjs:update`, the origin replica:

1. verifies exact document-room membership, the database session, and the
   current workspace role;
2. applies the update to its local in-memory `Y.Doc`;
3. relays it to other sockets in the local document room;
4. appends a PostgreSQL write to that process's per-document promise chain; and
5. publishes a base64-encoded copy to `document:<documentId>:updates`.

The local relay does not wait for PostgreSQL or Redis. The sender receives no
durability acknowledgement. Persistence and Redis publication failures are
logged, but the accepted update is not retried by the gateway and the sender is
not told that durable storage or cross-replica delivery failed.

A receiving replica ignores its own `originId`, applies the update only when it
already has that document loaded, and relays it to its local room. It does not
write a second copy to PostgreSQL. A replica that does not have the document
loaded can reconstruct later from PostgreSQL.

Redis Pub/Sub has no replay or acknowledgement. If a loaded replica misses an
update, its in-memory `Y.Doc` and connected clients can diverge until the socket
rejoins and synchronizes or the process reloads durable state. Redis recovery
alone does not repair a missed live update.

### Awareness and chat

Awareness uses `document:<documentId>:awareness`; chat uses
`workspace:<workspaceId>:chat`. Both are delivered to local rooms and fanned
out through Redis. Neither stream is stored in PostgreSQL or replayed. Message
loss during a disconnect, process restart, Redis failure, or subscription gap
is expected. Awareness is rebuilt by connected clients; chat history is lost.

Every replica pattern-subscribes to the collaboration and chat channels, so
Redis delivery and subscriber work grow with the number of replicas. Yjs and
awareness payloads are base64 encoded inside JSON for Redis, increasing wire
size beyond the original binary payload.

## Persistence and compaction

### Sequence allocation

Each `DocumentUpdate` has a per-document integer `seq`. With Redis available,
the first allocation by a process reads the maximum sequence from both
`DocumentUpdate` and `Snapshot`, then runs a Lua operation that seeds
`meridian:doc:<documentId>:seq` only if absent and increments it atomically.
Later allocations by that process use `INCR`.

In the absence of a concurrent history reset, this prevents duplicate
allocations while every writer uses the same healthy Redis counter. If Redis is
unavailable or a counter command fails, the service falls back to a
process-local counter seeded from the PostgreSQL high-water mark. That fallback
is collision-free only when one API process is writing. PostgreSQL has a unique
constraint on `(documentId, seq)`; a collision causes that update write to fail,
be logged, and be dropped from durable history.

The first CRDT seed for a saved document uses a deterministic Yjs client ID and
inserts sequence zero with duplicate skipping. This protects the initial
cold-open race, but it does not address later asynchronous persistence or
compaction races.

### Cross-replica compaction race

The Redis sequence is allocated before the corresponding PostgreSQL insert,
and promise chains serialize writes only inside one process. The following
ordering is possible:

1. Replica A allocates sequence 5, but its PostgreSQL insert is delayed.
2. Replica B allocates and inserts sequence 6.
3. Replica B compacts through sequence 6. Its serializable transaction rebuilds
   a snapshot from the durable rows visible at that time, where sequence 5 is
   absent, and deletes covered update rows.
4. Replica A inserts sequence 5 after the compaction commits.
5. A cold load reads the snapshot at sequence 6 and then queries only updates
   with `seq > 6`, so the late sequence 5 update is never applied.

Serializable isolation protects the compaction transaction from conflicting
database transactions; it does not reserve Redis-allocated sequences or prove
that every lower sequence has already been inserted. The local compaction
counter and `lastPersistedSeq` are also process-local. Consequently, the current
compaction design is not safe for concurrent writers on multiple API replicas.

Within one process, updates for a document are serialized. Graceful application
shutdown waits for that process's pending write chains. A crash, forced kill, or
host loss can still discard updates accepted in memory but not yet inserted.
Database write errors are swallowed after logging so later queued updates can
continue; there is no durable retry queue.

### Version restore

Version restore first commits the saved `Document.content` and a new
`DocumentVersion`, then separately reconciles CRDT state on the replica that
handled the request. If that replica has the document loaded, it mutates the
local `Y.Doc`, emits `yjs:update` and `document:restored` to its local room, and
resets CRDT history. If it does not have the document loaded, it deletes CRDT
history so a later cold open seeds from saved content.

The restore update and notification are not published to Redis. Other replicas
can retain stale in-memory documents and can continue writing through their own
queues while the origin replica deletes history and the shared sequence key.
There is no cross-replica document lock, generation number, or fencing token.
The saved-content transaction and CRDT reset are also not one atomic database
operation. Do not execute version restores while more than one API replica can
hold or write the document.

## Redis failure behavior

Redis is optional at application startup because a single API process can use
local collaboration and counters. It is a hard operational dependency for any
multi-replica topology.

The publisher and subscriber each have a three-second startup connection
timeout, no offline command queue, and no automatic reconnect strategy. An
initial connection failure is caught and the API continues to start. Publish
failures are logged and discarded. Sequence allocation failures fall back to a
local counter. The application does not automatically remove other replicas or
fail closed.

| Failure | Observable behavior | Required response for a multi-replica deployment |
|---|---|---|
| Redis unavailable at startup | API starts; `/ready` can return 200 with Redis `disabled`; Pub/Sub is not subscribed; sequence allocation is local | Do not admit traffic to multiple replicas; restore Redis and restart the full API fleet |
| Redis lost after startup | Pub/Sub and counters fail without retry; `/ready` can still return 200 with Redis `error`; loaded documents and sandboxes may diverge | Stop collaborative writes, drain replicas, restore Redis, and restart every replica |
| Redis command fails transiently | The affected update can use a local sequence and its publication can be lost | Treat as loss of multi-replica safety, not as a harmless transient |
| Redis data is replaced or restored | Fresh processes can seed counters from durable PostgreSQL, but running processes can retain stale client state and seed flags | Quiesce writes and perform a coordinated restart before resuming multiple replicas |

`GET /health` only confirms that the process is running. `GET /ready` returns
503 only when PostgreSQL is unavailable. Redis appears as `ok`, `error`, or
`disabled` in the response but never changes the HTTP readiness decision. A
multi-replica deployment therefore needs an external Redis health gate and
alerting; the built-in readiness endpoint alone is insufficient.

A safe Redis recovery procedure is:

1. Stop admitting HTTP mutations and Socket.IO collaboration traffic.
2. Gracefully drain or stop all API replicas so local write queues get a chance
   to finish.
3. Restore Redis and verify it independently.
4. Restart the entire API fleet and require Redis `ok` before admitting it.
5. Reconnect clients so Socket.IO rooms and passive realtime state are rebuilt.

Reconnect and Yjs sync do not provide a durable recovery protocol for an update
the server accepted and then failed to persist. If persistence failed before
the outage, restarting cannot recreate updates that existed only in process or
client memory. Recover those through explicit client export, backups, or an
application-specific repair procedure.

## Other failure modes

| Failure | Actual behavior | Operational consequence |
|---|---|---|
| PostgreSQL unavailable | `/ready` returns 503; HTTP data paths fail; protected socket events lose their database reauthorization path; asynchronous persistence errors are logged without retry | Remove the replica from traffic and stop writes until PostgreSQL is healthy; do not treat in-memory Yjs state as durable |
| Graceful replica termination | Nest shutdown hooks drain that process's write chains, close its PTYs, and close database and Redis clients | Allow enough termination grace; clients must reconnect and rejoin rooms on another replica |
| Crash, `SIGKILL`, or host loss | No drain occurs; pending Yjs writes, awareness, chat, sockets, and PTYs on that process are lost | Durable rows can be reloaded, but accepted asynchronous updates may be unrecoverable |
| Socket.IO affinity loss | Polling and upgrade requests can reach a process that does not own the Socket.IO session; local rooms, authorization caches, and PTYs do not follow the client | Expect connection errors or reconnects; fix affinity before relying on realtime behavior |

Both `/health` and `/ready` are exempt from the stricter authentication
throttler but remain subject to the default per-process HTTP throttle. Configure
probe frequency so infrastructure checks do not exhaust that budget.

## Terminal behavior across replicas

A terminal session is a `node-pty` child process tied to one Socket.IO socket
and one API process. It cannot migrate or reattach on another replica. A
reconnect starts a new shell and re-materializes the workspace from saved
PostgreSQL document content.

The materialized directory is a disposable projection, not a shared
filesystem:

- REST document create, bulk import, save, rename, delete, and restore paths
  apply local sandbox operations and publish unversioned operations on
  `meridian:sandbox:<workspaceId>:sync`;
- unsaved Yjs edits are not projected until a REST save updates
  `Document.content`;
- shell changes made directly inside the sandbox are not written back to
  PostgreSQL and are discarded by a later materialization; and
- Redis Pub/Sub does not replay missed sandbox operations.

Concurrent document mutations handled by different replicas have no global
sandbox operation version or fencing token. Because each origin applies its own
operation before publishing, replicas can observe conflicting operations in
different effective orders. An active sandbox can therefore diverge from saved
database state even while Redis is available, and it can miss changes entirely
during a Redis gap. Re-materialization from PostgreSQL is the repair path.

Terminal start, input, resize, and run-file operations recheck session and role
state with the same one-second cache and 10-second audit cadence described
above. Redis invalidations can kill affected terminals on other replicas, but
missed invalidations fall back to the database audit. Terminal events do not
pass through `WsRateLimiter`; use ingress controls and OS-level resource limits.

There is one PTY per socket but no global PTY, process, CPU, or memory quota. A
single user can open multiple sockets. Sandbox directories use local temporary
storage and may outlive a PTY. A natural PTY exit currently removes the terminal
session but does not unregister its sandbox projection, so later sync messages
can continue touching that inactive directory until the registration is
replaced or the process restarts.

The sandbox changes the shell's working directory and reduces its environment,
but it is not an OS isolation boundary. The shell runs as the API server's OS
user. See the [server terminal security guidance](../server/README.md#optional-terminal)
before enabling it.

## Rate limiting and capacity

The default Nest throttler storage is process-local. With `N` evenly balanced
replicas, a caller can receive approximately `N` independent HTTP budgets. Use
an ingress, gateway, or shared abuse-control service for a deployment-wide
limit, especially on authentication routes.

`WsRateLimiter` applies a fixed one-second budget per socket to selected
`EditorGateway` events, including document joins, workspace joins, chat, Yjs
sync/update, and awareness. It is not a per-user or distributed limit. Multiple
sockets receive multiple budgets. `leaveDocument` and all `TerminalGateway`
events are outside that limiter.

Each replica retains one in-memory `Y.Doc` and awareness object for every open
document routed to it. The object remains for `DOC_TEARDOWN_GRACE_MS` after its
last local reference is released. The persistence service's per-document
sequence, write-chain, compaction-count, and last-sequence maps are not evicted,
so a long-lived process accumulates bookkeeping for every document it has
persisted until restart.

Capacity planning must include duplicated hot-document memory, Redis fan-out to
every subscriber, base64/JSON message expansion, PostgreSQL connections from
every replica, local terminal processes, and temporary sandbox storage. The
application exposes health endpoints and structured logs but no built-in
metrics endpoint or distributed backpressure mechanism.

## Deployment and shutdown checklist

1. Use one API replica for durable collaboration and version restore until the
   persistence and restore limitations in this document are fixed.
2. Apply committed Prisma migrations once before admitting a new application
   version. Do not let every replica run `prisma migrate dev`.
3. Start and verify PostgreSQL and Redis before the API fleet. The repository's
   Compose file is development-only and does not define a production topology.
4. Keep every replica on the same build and configuration. Redis payloads have
   no protocol-version negotiation, so avoid incompatible mixed-version fleets.
5. Configure `/socket.io/` affinity for handshake, polling, upgrade, and the
   entire session. Forward WebSocket upgrades and preserve credentials.
6. Protect Redis as an internal message bus and counter store. Do not expose it
   publicly or share its Pub/Sub namespace with another environment.
7. Add deployment-wide HTTP and terminal abuse controls. Do not multiply the
   configured per-process limits and assume they are global.
8. Monitor PostgreSQL readiness, Redis ping status, persistence failures,
   compaction failures, authorization audit errors, Redis publish errors,
   connection count, process memory, PTY count, and temporary storage.
9. Allow enough termination grace for local persistence queues to drain.
   Nest shutdown hooks flush local write chains and close terminal processes,
   but they cannot help after `SIGKILL`, host loss, or a grace timeout.
10. For Redis incidents or suspected document divergence, quiesce writes and
    restart the full fleet rather than relying on automatic recovery.

## Verification boundary

Repository tests cover individual services and gateways, HTTP integration, and
browser collaboration through a single API process. They do not start multiple
API processes or exercise Redis ordering, compaction races, restore fencing,
Redis outage and recovery, or concurrent sandbox operation ordering. The
multi-replica classifications and limitations in this document are therefore
derived from the current source paths; these scenarios are not proven safe by
the current CI suite.
