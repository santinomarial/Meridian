# Realtime performance baseline

This document records a repeatable local baseline for Meridian's collaborative
editing path. It is evidence about one measured environment, not a production
capacity guarantee. Production sizing still requires a representative test
against the deployed load balancer, network, PostgreSQL, Redis, and observability
stack.

The baseline was captured on July 24, 2026. All reported test stages completed
without a failed user, persistence failure, acknowledgement timeout, or missing
expected peer-delivery event.

## Scope

The benchmark exercises the complete authenticated realtime write path:

1. Register a distinct account for each virtual user.
2. Create a workspace and add every non-owner account as an editor.
3. Establish a JWT-authenticated Socket.IO connection over WebSocket.
4. Join a document and wait for the server's join response.
5. Create and send incremental binary Yjs updates.
6. Correlate delivery of each update to every other socket in the document.
7. Wait for `yjs:ack`, which Meridian emits only after the PostgreSQL
   transaction commits.
8. Delete the synthetic accounts and owner workspace.

Each user keeps at most one update awaiting durable acknowledgement. This models
concurrent editors producing a steady sequence of small text changes. It does
not model large update payloads, disconnected-client replay, or a client
deliberately flooding the gateway.

## Measurement definitions

| Measurement | Boundary |
|---|---|
| Connection latency | Socket creation to the Socket.IO `connect` event |
| Join latency | `joinDocument` emission to `joinedDocument` |
| Peer-delivery latency | Sender emission to receipt of the same update by a different socket in the document |
| Durable acknowledgement latency | Sender emission to `yjs:ack` after the PostgreSQL commit |
| Durable throughput | Successfully acknowledged updates divided by the update stage duration |
| Fan-out delivery | Observed peer update events divided by `updates × peers in the same document` |

Peer delivery and durable acknowledgement are intentionally separate. The
gateway relays an accepted update to local peers before waiting for persistence,
while the sender's acknowledgement remains the durability boundary.

## Test environment

| Component | Configuration |
|---|---|
| Host | Apple Silicon (`arm64`) macOS host |
| Application | One compiled NestJS server process |
| Runtime | Node.js 24.13.1 |
| Database | Disposable PostgreSQL 16 Alpine container |
| Coordination | Disposable Redis 7 Alpine container |
| Client transport | Socket.IO WebSocket on loopback; no TLS or reverse proxy |
| Update | Small incremental Yjs text insertion |
| Snapshot threshold | Default `SNAPSHOT_EVERY_N_UPDATES=100` |

PostgreSQL and Redis used temporary storage. The application, load generator,
database, and Redis ran on the same development machine. Loopback results omit
internet latency and should not be compared directly with browser-to-production
latency.

## Results

### Shared-document staircase

Every user in this stage edited the same document. Five updates were sent per
user.

| Concurrent users | Durable updates | Durable throughput | Ack p50 | Ack p95 | Ack p99 | Fan-out delivery |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 50 | 369.78/s | 22.84 ms | 33.12 ms | 37.56 ms | 450/450 |
| 25 | 125 | 368.51/s | 64.86 ms | 71.48 ms | 82.58 ms | 3,000/3,000 |
| 50 | 250 | 389.84/s | 120.27 ms | 135.31 ms | 156.70 ms | 12,250/12,250 |
| 100 | 500 | 371.12/s | 270.44 ms | 288.50 ms | 325.81 ms | 49,500/49,500 |

The shared-document write rate stabilized at approximately 350–390 durable
updates per second in this environment. Ack latency increased with the number
of outstanding writers because a document has one local persistence chain and
one PostgreSQL advisory-lock serialization boundary. This preserves durable
ordering, but it makes a single unusually hot document the limiting workload.

### Sustained and distributed profiles

| Profile | Durable updates | Durable throughput | Ack p95 / p99 | Peer p95 / p99 | Fan-out delivery | Post-stage RSS | Event-loop p99 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 100 users, 1 document, 20 updates/user | 2,000 | 352.88/s | 333.56 / 351.62 ms | 4.36 / 76.07 ms | 198,000/198,000 | 282.33 MiB | 12.46 ms |
| 100 users, 10 documents, 3 updates/user | 300 | 1,588.59/s | 71.65 / 77.47 ms | 8.73 / 9.47 ms | 2,700/2,700 | Not retained | 15.51 ms |
| 250 users, 25 documents, 5 updates/user | 1,250 | 1,861.50/s | 180.01 / 205.44 ms | 31.04 / 35.04 ms | 11,250/11,250 | 542.88 MiB | 52.43 ms |

RSS and event-loop values are point-in-time process samples taken after a stage;
they are not high-water marks or leak measurements. The 100-user distributed
RSS sample was not retained in the final record and is intentionally not
reconstructed.

## Interpretation

The baseline supports these limited conclusions:

- Realtime correctness held for 100 users editing one document and for 250 users
  spread across 25 documents in the measured environment.
- Local peer relay remained responsive under the tested profiles. In the
  sustained 100-user hot-document stage, peer p95 was 4.36 ms even though
  durable ack p95 was 333.56 ms.
- Work distributed across documents achieved substantially higher durable
  throughput because persistence ordering is scoped per document.
- A single hot document is the primary measured serialization limit. Increasing
  API replica count does not remove the PostgreSQL per-document ordering
  boundary.
- Capacity planning must treat peer-delivery latency, durable-ack latency,
  database saturation, event-loop delay, and memory as distinct signals.

These results do not establish a maximum user count. They show that the tested
profiles completed correctly and expose where latency begins to accumulate.

## Limitations

This run did not exercise:

- TLS, WAN latency, packet loss, a reverse proxy, or a sticky load balancer;
- multiple API replicas or cross-replica Socket.IO routing;
- a managed or remotely hosted PostgreSQL or Redis service;
- Redis disconnect, reconnect, or subscriber lag during sustained traffic;
- long-running soak behavior, process restarts, or forced termination;
- large Yjs payloads, awareness churn, workspace chat, HTTP traffic, or terminal
  traffic mixed with document updates;
- browser rendering, Monaco processing, IndexedDB replay, or slow client
  devices; or
- production monitoring agents and infrastructure contention.

Before setting a production SLO or user limit, rerun the same workload against a
production-like environment, add multi-hour soak and failure-injection stages,
and test a workload distribution based on observed users per active document.

## Running the benchmark

Start a built server against a disposable, migrated PostgreSQL database and
Redis instance with metrics enabled. In another terminal:

```bash
cd server
npm run load:realtime
```

The command defaults to `10,25,50,100` users sharing one document, with five
durably acknowledged updates per user. It prints a human-readable summary and
a final `LOAD_RESULT_JSON=...` record suitable for archival.

To test 250 users split into groups of 10 per document:

```bash
cd server
LOAD_CONCURRENCY=250 \
LOAD_USERS_PER_DOCUMENT=10 \
LOAD_UPDATES_PER_USER=5 \
npm run load:realtime
```

| Variable | Default | Purpose |
|---|---:|---|
| `LOAD_BASE_URL` | `http://127.0.0.1:3100` | Running Meridian API target |
| `LOAD_CONCURRENCY` | `10,25,50,100` | Comma-separated stage sizes, each from 1 through 1,000 |
| `LOAD_UPDATES_PER_USER` | `5` | Sequential acknowledged updates sent by each user |
| `LOAD_ACK_TIMEOUT_MS` | `30000` | Connection, join, and acknowledgement timeout |
| `LOAD_PROVISION_BATCH_SIZE` | `5` | Account-provisioning and cleanup batch size, from 1 through 1,000 |
| `LOAD_USERS_PER_DOCUMENT` | `0` | Users per document; zero puts the whole stage in one document |
| `LOAD_ALLOW_REMOTE` | Unset | Must equal `true` before a non-loopback target is accepted |

The harness creates real accounts, memberships, documents, update rows, and
snapshots. It removes the synthetic accounts and owner workspace in a `finally`
block, including after a failed stage, but it must still be run against a
disposable or explicitly authorized environment. A process kill can prevent
cleanup. Never point it at production without an approved test plan and an
independent cleanup procedure.
