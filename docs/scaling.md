# Horizontal scaling and failure model

This document defines the current multi-replica behavior of the Meridian API
server. It covers the coordination paths that use PostgreSQL and Redis, the
state that remains local to each process, and the failure modes an operator must
account for. For component setup and configuration, see the
[server guide](../server/README.md). For the logical component layout, see the
[architecture overview](architecture.md).

## Current support boundary

Shared PostgreSQL, shared Redis, and Socket.IO session affinity are required for
multi-replica realtime collaboration, but they are not sufficient to make every
workflow equivalent to a single process.

Every durable Yjs write, compaction, checkpoint, and version restore acquires a
PostgreSQL transaction-scoped advisory lock for its document. This prevents the
former late-insert compaction race across API processes, even when Redis is
unavailable. Version restore is generation-fenced: the restore transaction bumps
`Document.crdtGeneration`, replaces the CRDT lineage, and causes stale writes to
be rejected before commit.

Multiple replicas can distribute ordinary HTTP work, retain correctly ordered
durable Yjs history, provide best-effort realtime fan-out, and converge after a
generation-fenced version restore. The remaining multi-replica limits are
operational rather than hidden data-integrity guarantees: Redis Pub/Sub has no
durable replay for awareness/chat, terminal processes are local, terminal file
projection is best effort, and rate limiting remains per process.

| Area | Current classification |
|---|---|
| HTTP authentication and metadata CRUD | Shared PostgreSQL state and distributable; document content writes and version restore are serialized through document advisory locks; throttling is per process |
| Live Yjs relay | Best effort through Redis Pub/Sub while Redis and all subscriptions are healthy |
| Yjs persistence and compaction | Ordered by a PostgreSQL document advisory lock; durable history is safe across application processes that use this service |
| Version restore | Generation-fenced and convergent across replicas that process Redis restore-control events or the generation audit |
| Awareness and workspace chat | Ephemeral, best effort, and not replayed |
| Session and membership revocation | Redis invalidation fast path plus PostgreSQL rechecks and periodic audits |
| Terminal PTY | Local to one process and one socket |
| Terminal sandbox projection | Best-effort Redis fan-out with no replay or global operation ordering |
| HTTP rate limiting | In-memory and per process |
| Editor/chat gateway rate limiting | In-memory and per socket; selected `EditorGateway` events only |
| Terminal gateway rate limiting | In-memory and per socket for start, run-file, input, and resize; stop is unmetered |

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
| Document sequence allocation | PostgreSQL document advisory lock, with Redis acceleration | Ordered per document even when Redis commands fail |
| Yjs persistence queue | Each API process | Per-document promise chain; PostgreSQL lock coordinates durable write, compaction, and reset across processes |
| Authorization cache | Each API process | One-second cache; invalidated locally and through Redis |
| HTTP throttle counters | Each API process | No shared global budget |
| Editor/chat throttle counters | Each API process, keyed by socket ID | One fixed one-second budget per socket |
| Terminal throttle counters | Each API process, keyed by `terminal:<socketId>` | Separate fixed one-second budget per socket |
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

Document-writing HTTP routes have additional boundaries:

- a meaningful content checkpoint selects `max(versionNumber) + 1` under the
  document advisory lock; concurrent checkpoints of the same durable text
  create at most one version;
- `POST /documents/:id/checkpoint` projects durable CRDT text into
  `Document.content`; `PATCH` is metadata-only and rejects `content`;
- create and bulk import write `Document.content` for new files; overwriting an
  existing file's content bumps `crdtGeneration` and replaces the CRDT lineage;
  and
- ZIP export and a newly materialized terminal read the checkpoint
  (`Document.content`), not the live `Y.Doc`.

Unsaved collaborative edits therefore remain absent from export/terminal until
checkpoint. Load balancing the HTTP request to another replica does not change
that boundary: every replica projects from the same durable CRDT rows under the
shared advisory lock. Version restore remains the specialized path that rewrites
both the checkpoint and the lineage.

## Realtime fan-out

### Yjs document updates

For an accepted `yjs:update`, the origin replica:

1. verifies exact document-room membership, the database session, and the
   current workspace role;
2. applies the update to its local in-memory `Y.Doc`;
3. relays it to other sockets in the local document room (low-latency sticky
   path; peers may see the edit before durable commit);
4. awaits a PostgreSQL write under `(documentId, generation, updateId)`
   idempotency, then emits `yjs:ack` `{ documentId, updateId, generation, seq }`
   to the sender; and
5. publishes a base64-encoded copy (with `seq` + `updateId`) to
   `document:<documentId>:updates` only after commit.

The sender's durability acknowledgement is the post-commit `yjs:ack`. Clients
enqueue the update in IndexedDB before emit and dequeue on ack; reconnect
resends pending entries with the same `updateId`. Persist failure emits
`yjs:nack` without dequeuing. Redis publication failures after commit are
logged; receivers that miss a message detect a `seq` gap and catch up from
PostgreSQL via `fetchUpdatesAfter`.

A receiving replica ignores its own `originId`, applies the update only when it
already has that document loaded, and relays it to its local room. It does not
write a second copy to PostgreSQL. A replica that does not have the document
loaded can reconstruct later from PostgreSQL.

Redis Pub/Sub itself has no replay. Sequence numbers on post-commit messages
plus PostgreSQL catch-up close the gap for loaded replicas that miss a live
update. Redis recovery alone still does not repair awareness or chat.

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

Each `DocumentUpdate` has an integer `seq` scoped to `(documentId, generation)`.
The write transaction first takes
`pg_advisory_xact_lock(hashtextextended(documentId, 0))`. With Redis available,
the transaction uses a Lua seed-and-increment operation on
`meridian:doc:<documentId>:gen:<generation>:seq`; the first allocation seeds
from the maximum sequence in `DocumentUpdate` and `Snapshot` for that lineage.
Later allocations use `INCR`.

When Redis is unavailable or a counter command fails, the same locked
transaction reads that durable high-water mark and assigns the next value. The
advisory lock is released automatically at transaction completion or connection
loss. It serializes all service-managed writes for the document, so the fallback
is collision-free across API processes rather than process-local.

The first CRDT seed for a saved document uses a deterministic Yjs client ID and
inserts sequence zero with duplicate skipping. The first client cannot edit
until its server has awaited that seed path. The advisory lock then orders later
asynchronous writes, compaction, checkpoint, and restore operations.

### Compaction ordering

Every process still counts locally and attempts compaction after its own
`SNAPSHOT_EVERY_N_UPDATES` successful writes. The compaction transaction takes
the same document advisory lock before it reads a base snapshot, replays durable
updates through its cutoff, inserts the replacement snapshot, and deletes
covered rows. A pending writer must either commit before compaction begins or
wait until it ends and receive a sequence above the snapshot cutoff. A cold
load therefore cannot skip a late lower-sequence row.

Within one process, updates for a document are serialized by the local promise
chain. Graceful application shutdown waits for that process's pending write
chains. A crash, forced kill, or host loss can still discard updates accepted in
memory but not yet inserted. Database write errors are swallowed after logging
so later queued updates can continue; there is no durable retry queue.

### Version restore

Version restore is one PostgreSQL transaction under the document advisory
lock. It increments `Document.crdtGeneration`, rewrites `Document.content`,
records a restored `DocumentVersion`, and replaces CRDT history with a single
seq-0 snapshot of the restored text under the new generation.

After commit, the handling replica reloads its local `Y.Doc`, emits
`document:restored` to connected clients (who discard their local lineage and
re-run the join/sync handshake), and publishes a restore-control event on
Redis so every other replica does the same. Persistence writes tagged with the
old generation are rejected inside their locked transaction, so a replica that
missed the control event still cannot commit pre-restore state. A periodic
generation audit evicts any remaining stale in-memory documents.

Terminal file projection after restore remains best-effort and outside the
CRDT transaction. Durable collaboration acknowledgements (`yjs:ack` after
PostgreSQL commit, client IndexedDB queue, post-commit Redis `seq` catch-up)
are implemented for live Yjs updates.

## Redis failure behavior

Redis is optional at application startup because a single API process can use
local collaboration and PostgreSQL-backed sequence ordering. It is an
operational dependency for cross-replica realtime fan-out, not for durable
sequence allocation or compaction ordering.

The publisher and subscriber each have a three-second startup connection
timeout, no offline command queue, and capped exponential reconnect with
automatic `PSUBSCRIBE` restoration. An initial connection failure is caught and
the API continues to start (`REDIS_REQUIRED` then keeps `/ready` at 503 until
Redis recovers). Publish failures are logged and discarded. Sequence allocation
failures fall back to the PostgreSQL high-water mark while holding the document
advisory lock. Channels and counter keys honor `REDIS_KEY_PREFIX` so multiple
environments can share one Redis deployment.

| Failure | Observable behavior | Required response for a multi-replica deployment |
|---|---|---|
| Redis unavailable at startup | API starts; `/ready` can return 200 with Redis `disabled`; Pub/Sub is not subscribed; durable sequences still use PostgreSQL locks | Do not admit cross-replica collaboration; restore Redis and restart the API fleet before enabling it |
| Redis lost after startup | Commands issued during the outage fail without offline retry; clients reconnect and resubscribe, but lost Pub/Sub messages are not replayed; `/ready` can still return 200 with Redis `error`; loaded documents and sandboxes may diverge, while durable sequence ordering continues | Stop collaborative writes, drain replicas, restore Redis, and restart every replica |
| Redis command fails transiently | The update uses PostgreSQL high-water allocation under the document lock; its publication can still be lost | Treat as loss of cross-replica realtime safety, not as a harmless transient |
| Redis data is replaced or restored | Fresh processes can reseed acceleration keys from PostgreSQL, but running processes can retain stale client state and Redis seed flags | Quiesce writes and perform a coordinated restart before resuming cross-replica collaboration |

`GET /health` only confirms that the process is running. `GET /ready` returns
503 when PostgreSQL is unavailable, and also when `REDIS_REQUIRED=true` and
Redis is not `ok`. Redis appears as `ok`, `error`, or `disabled` in the response.
Multi-replica deployments should set `REDIS_REQUIRED=true`, scrape `/metrics`,
and still alert on Redis independently.

A recommended containment and recovery sequence is:

1. Stop admitting HTTP mutations and Socket.IO collaboration traffic.
2. Gracefully drain or stop all API replicas so local write queues get a chance
   to finish.
3. Restore Redis and verify it independently.
4. Restart the entire API fleet and require Redis `ok` before admitting it.
5. Reconnect clients so Socket.IO rooms and passive realtime state are rebuilt.

This sequence limits further divergence but cannot guarantee recovery of a
realtime publication that was already lost when Redis failed. Reconnect and Yjs
sync do not provide a durable recovery protocol for an update the server
accepted and then failed to persist. If persistence failed before the outage,
restarting cannot recreate updates that existed only in process or client
memory. Preserve text through a manual copy from a client that still holds it or
a successful explicit Save before that client state is lost. A Save protects
`Document.content` and version history but does not repair CRDT history
automatically, so complete reconciliation in a controlled single-replica
maintenance window. Otherwise, recovery requires backups or an
application-specific repair procedure.

## Other failure modes

| Failure | Actual behavior | Operational consequence |
|---|---|---|
| PostgreSQL unavailable | `/ready` returns 503; HTTP data paths fail; protected socket events fail reauthorization after their short caches expire; an event accepted from cache can still encounter an asynchronous persistence failure with no retry | Remove the replica from traffic and stop writes until PostgreSQL is healthy; do not treat in-memory Yjs state as durable |
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
missed invalidations fall back to the database audit. Those four operations use
an independent, namespaced per-socket `WsRateLimiter` budget; `terminal:stop`
is unmetered. Use ingress controls and OS-level resource limits as well.

There is one PTY per socket but no global PTY, process, CPU, or memory quota. A
single user can open multiple sockets. Concurrent sockets for one
workspace/user share a reference-counted local projection. Natural PTY exit
releases its registration, and normal final-session teardown removes the
directory through the same per-root operation queue used by materialization and
sync. A replacement-session reservation cancels pending cleanup. Abrupt process
or host termination can still leave temporary data behind.

The sandbox changes the shell's working directory and reduces its environment,
but it is not an OS isolation boundary. The shell runs as the API server's OS
user. See the [server terminal security guidance](../server/README.md#optional-terminal)
before enabling it.

## Rate limiting and capacity

The default Nest throttler storage is process-local. With `N` evenly balanced
replicas, a caller can receive approximately `N` independent HTTP budgets. Use
an ingress, gateway, or shared abuse-control service for a deployment-wide
limit, especially on authentication routes. The application does not configure
Express `trust proxy`; define the trusted-proxy model explicitly so application
and ingress controls use the intended client address.

`WsRateLimiter` applies a fixed one-second budget per socket to selected
`EditorGateway` events, including document joins, workspace joins, chat, Yjs
sync/update, and awareness. A separate namespaced budget protects
`TerminalGateway` start, run-file, input, and resize events. Neither budget is
per user or distributed, so multiple sockets receive multiple budgets.
`leaveDocument` and `terminal:stop` are unmetered.

Each replica retains one in-memory `Y.Doc` and awareness object for every open
document routed to it. The object remains for `DOC_TEARDOWN_GRACE_MS` after its
last local reference is released. Teardown destroys that state and asks the
persistence service to evict its per-document Redis seed flag, settled
write-chain, compaction count, and last-sequence entry. Eviction waits for the
captured chain and is abandoned if a newer write appears concurrently.

Capacity planning must include duplicated hot-document memory, Redis fan-out to
every subscriber, base64/JSON message expansion, PostgreSQL connections from
every replica, local terminal processes, and temporary sandbox storage. The
application exposes health endpoints, structured logs, and a process-local
Prometheus `/metrics` endpoint, but no distributed backpressure mechanism.

## Deployment and shutdown checklist

1. Use one API replica for the simplest operations model, or use multiple API
   replicas only with shared PostgreSQL, shared Redis, Socket.IO affinity, and
   the remaining realtime limitations documented here.
2. Apply committed Prisma migrations once before admitting a new application
   version. Do not let every replica run `prisma migrate dev`.
3. Start and verify PostgreSQL and Redis before the API fleet. The repository's
   Compose file is development-only and does not define a production topology.
4. Keep every replica on the same build and configuration. Redis payloads have
   no protocol-version negotiation, so avoid incompatible mixed-version fleets.
5. Configure `/socket.io/` affinity for handshake, polling, upgrade, and the
   entire session. Forward WebSocket upgrades and preserve credentials.
6. Protect Redis as an internal message bus and sequence accelerator. Do not
   expose it publicly or share its Pub/Sub namespace with another environment.
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
browser collaboration through a single API process. The dual-AppModule harness
(`multi-replica.e2e-spec.ts`, `restore-fencing.e2e-spec.ts`) boots two Nest
processes against shared PostgreSQL and Redis and covers concurrent durable
seq allocation, Redis Yjs fan-out, PostgreSQL catch-up on seq gaps, restore
fencing during peer writes, checkpoint under concurrent peer persist, and
pinned Socket.IO clients receiving cross-replica `yjs:ack` / `yjs:update`.

They do not start a sticky load-balanced multi-replica deployment in a cloud
provider, run Redis chaos under sustained load, or prove SIGKILL drain
behavior. Those remain staging/platform concerns. In-repo production ops
(Dockerfiles, migrate job, Redis-required readiness, reconnect/resubscribe,
key prefixing, Prometheus metrics, backup smoke test, runbooks, and container
scanning) are documented in [operations.md](operations.md).
