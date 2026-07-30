# Persistence, compaction, and restore

Collaborative durability is a PostgreSQL protocol. Redis accelerates allocation
and carries control/fan-out messages, but document advisory locks, generation
checks, and committed rows are the correctness boundary.

## Ordering durable updates

Each active `Y.Doc` is tagged with the `Document.crdtGeneration` from which it
was loaded. A write is appended to a process-local per-document promise chain,
then runs in a PostgreSQL transaction that:

1. acquires a transaction-scoped advisory lock derived from the document ID;
2. rereads the document generation and rejects a stale lineage;
3. returns an existing row when the generation/update ID already committed;
4. allocates the next sequence for that generation; and
5. inserts the update before committing.

When Redis is ready, a seed-and-increment Lua operation accelerates sequence
allocation. The first local use seeds the prefixed per-lineage counter from the
maximum durable update/snapshot sequence; later writes use increment. If Redis
is unavailable or a command fails, the transaction reads the same PostgreSQL
high-water mark while still holding the advisory lock. Sequence uniqueness and
ordering therefore survive Redis failure.

The process-local chain preserves local call order and gives graceful shutdown
something to drain. It does not coordinate replicas. After document teardown,
the service waits for the captured chain tail and removes local bookkeeping if
no newer write appeared. The shared Redis sequence key remains in place.

## Compaction

Each process counts its own successful writes. At the configured threshold it
attempts compaction under the same document advisory lock:

```mermaid
flowchart TD
    Lock["Acquire document advisory lock"]
    Fence{"Generation still current?"}
    Base["Load latest snapshot"]
    Updates["Replay durable updates through local committed cutoff"]
    Snapshot["Insert replacement snapshot"]
    Delete["Delete covered updates and older snapshots"]

    Lock --> Fence
    Fence -->|yes| Base --> Updates --> Snapshot --> Delete
    Fence -->|no| Stop["Stop without mutation"]
```

Using the same lock for writes and compaction prevents a lower-sequence write
from being inserted after compaction has deleted rows through a higher cutoff.
The snapshot is rebuilt from durable rows, not copied from one replica's
possibly divergent in-memory document. Compaction is asynchronous and
best-effort; it reduces replay cost but is not the durability acknowledgement.
The client durability boundary remains post-commit `yjs:ack`.

## Generation-fenced restore

Restore replaces a lineage because merging an older plain-text version into the
current CRDT would preserve unwanted pre-restore items.

```mermaid
sequenceDiagram
    participant HTTP as Restore request
    participant PG as PostgreSQL
    participant Local as Local restore service
    participant Redis
    participant Peer as Other replica
    participant Client

    HTTP->>PG: lock document
    HTTP->>PG: increment generation, checkpoint restored text,<br/>create version, replace history with seq-0 snapshot
    PG-->>HTTP: commit new generation
    HTTP->>Local: applyRestore
    Local->>Local: reload loaded Y.Doc
    Local-->>Client: document:restored
    Local->>Redis: document:<id>:restore
    Redis-->>Peer: restore-control event
    Peer->>Peer: clear lineage bookkeeping and reload
    Peer-->>Client: document:restored
```

Any old-generation write that reaches its locked transaction after the restore
is fenced and cannot commit. A replica that misses the Redis restore channel is
still protected durably; a periodic generation audit compares loaded documents
with PostgreSQL and reloads stale ones. A fenced write also triggers an
immediate database resynchronization attempt.

Terminal projection is updated only after the restore transaction and remains
best-effort. Redis control delivery and client resync improve convergence; the
generation check is what prevents pre-restore state from becoming durable
again.

The roles of checkpoints and versions are explained in
[Document model and save](document-model-and-save.md). Live relay and
acknowledgement timing are in
[Realtime collaboration](realtime-collaboration.md).
