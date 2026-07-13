# Horizontal scaling

This document describes how Meridian's backend behaves across multiple server
instances, what is required to run more than one, and the known limitations.

## TL;DR

Running multiple backend replicas requires **two pieces of shared
infrastructure** and **one routing rule**:

1. A shared **PostgreSQL** (already the source of truth).
2. A shared **Redis** (used for cross-instance fan-out *and* the shared
   document-sequence counter).
3. **Sticky sessions for WebSocket connections** — a given Socket.IO connection
   must stay pinned to the instance that accepted it for its whole lifetime.
   Plain HTTP requests can be load-balanced freely because each request checks
   its JWT against the shared PostgreSQL session record.

With those in place, the components below are cross-instance safe. Without
Redis, the server automatically degrades to correct **single-instance**
behavior.

## Per-component status

| Component | Cross-instance mechanism | Status |
|---|---|---|
| Yjs document updates | Redis pub/sub fan-out (`document:*:updates`) + per-instance in-memory `Y.Doc`, reconciled by replaying fanned-out updates | ✅ Works |
| Awareness (cursors/selections) | Redis pub/sub fan-out (`document:*:awareness`) | ✅ Works |
| Workspace chat | Redis pub/sub fan-out (`workspace:*:chat`) | ✅ Works |
| **Document persistence `seq` counter** | **Atomic Redis counter** (`meridian:doc:<id>:seq`), seeded from the DB high-water mark | ✅ Works (was the main gap) |
| **Session/member revocation** | Local + Redis invalidation, per-event DB checks, and a 10-second passive sweep | ✅ Bounded and cross-instance |
| **Terminal sandbox sync** | **Redis pub/sub fan-out** (`meridian:sandbox:*:sync`) of write/mkdir/delete/rename ops | ✅ Works (with caveats below) |
| Terminal PTY session | Instance-local process; reattach re-materializes from the DB | ⚠️ Sticky-bound by nature |
| WS message rate limiter | Per-socket, in-memory | ✅ Correct under sticky sessions |
| HTTP auth / REST | JWT plus a revocable shared PostgreSQL session row | ✅ Replica-local request handling |

## Details

### Document persistence sequence counter

Every persisted Yjs update gets a `seq` that must be globally unique and
monotonic *per document* so updates can be ordered against snapshots when
rebuilding a document on a cold load.

- **Multi-instance:** when Redis is available, `seq` is allocated with an
  atomic Redis counter. The counter is seeded once (per process) to the DB
  high-water mark — `MAX(DocumentUpdate.seq, Snapshot.seq)` — via a small Lua
  script that seeds-if-absent then `INCR`s, so two replicas racing the first
  allocation cannot both seed. Subsequent allocations are a plain `INCR`.
- **Single-instance fallback:** when Redis is unavailable, allocation falls
  back to a per-process in-memory counter (also seeded from the DB high-water
  mark). This matches the original behavior and avoids a DB round-trip per
  keystroke.

Why this is safe: Yjs updates are commutative/idempotent, so `seq` is used for
ordering and snapshot cutoffs. Writes for one document are serialized through
a per-document promise chain, and each allocated `seq` is written before the
next is allocated. Compaction reconstructs state from durable rows and replaces
covered rows inside a serializable PostgreSQL transaction, so two replicas
cannot delete updates absent from a snapshot. A graceful shutdown drains every
pending write chain.

The first Yjs seed is also cross-instance safe: replicas derive the same seed
client id from the document id and insert seq 0 with `skipDuplicates`, producing
byte-identical initial CRDT state during a cold-open race.

Implemented in `DocumentPersistenceService` + `RedisService.allocateSeq/incr`.

### Terminal

A PTY is a live OS process with a working directory on the **local
filesystem** of one instance — it cannot be migrated. Two things make this work
across replicas:

1. **Sticky WebSocket routing** keeps a user's terminal socket (and thus its
   PTY) on one instance for the session's lifetime.
2. **Materialize-from-DB on start** (`TerminalSandboxService.materialize`)
   rebuilds the sandbox from the database — the source of truth — so if a
   client reconnects and lands on a *different* instance, that instance
   reconstructs an equivalent sandbox. Failover is therefore correct, just not
   seamless (a fresh shell).

The remaining gap was **live edit sync**: a document edit (plain HTTP) can be
handled by any instance, not necessarily the one hosting the sandbox. This is
now closed by publishing each sandbox op (write/mkdir/delete/rename, carrying
the new content) over Redis (`meridian:sandbox:*:sync`); the instance hosting
the sandbox applies it to disk. An origin guard prevents an instance from
re-applying its own broadcast. The fan-out only runs when `ENABLE_TERMINAL` is
on (otherwise no sandboxes exist anywhere).

Implemented in `TerminalSandboxService`.

### WS message rate limiter

`WsRateLimiter` is keyed by `socketId` and enforces a per-second budget **per
connection**. Because a connection lives entirely on one instance (sticky
sessions), all of its messages are counted by that instance — so the per-socket
limit is enforced correctly with any number of replicas. It is intentionally a
per-connection limit, not a global per-user limit; a user opening N connections
across instances gets N budgets, which is acceptable (and the same as most
WebSocket gateways). No shared state is needed.

## Requirements & deployment sketch

```
                     ┌─────────── Load balancer ───────────┐
   HTTP (stateless) ─┤  • REST: round-robin                │
   WS (sticky)       ─┤  • WebSocket: sticky by connection │
                     └──────┬───────────┬───────────┬──────┘
                            │           │           │
                        instance 1  instance 2  instance 3
                            │           │           │
                 ┌──────────┴───────────┴───────────┴──────────┐
                 │   shared PostgreSQL        shared Redis      │
                 │   (source of truth)   (fan-out + counters)   │
                 └──────────────────────────────────────────────┘
```

- **Sticky WebSocket sessions are mandatory.** Meridian does its own Redis
  pub/sub fan-out rather than using `@socket.io/redis-adapter`, so a socket's
  room broadcasts originate on its instance; the connection must not hop
  instances mid-session. (Switching to the Socket.IO Redis adapter is a viable
  alternative but would duplicate the existing manual fan-out, so it is not
  used.)
- **Redis is a hard dependency for multi-instance.** If Redis is down the
  server keeps working as a correct single instance; it does not silently
  half-scale.

## Known limitations

- **Terminal sandbox sync publishes on every save while `ENABLE_TERMINAL` is
  on**, even if no terminal is currently open anywhere. This is bounded (the
  terminal is opt-in and off by default); a future refinement could gate
  publishing on a Redis-tracked set of workspaces with an active sandbox.
- **Not container-isolated** — see the README's terminal section; this is a
  security property, independent of scaling.
