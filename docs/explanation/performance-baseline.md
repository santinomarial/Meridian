# Performance baseline

> Historical evidence, not a current benchmark: these numbers were recorded on
> July 24, 2026 and were not independently re-run or verified during this
> documentation rewrite. They are not a production capacity guarantee.

The recorded load harness exercised authenticated Socket.IO connection and
join, small incremental Yjs updates, peer delivery, and `yjs:ack` after the
PostgreSQL transaction committed. Each virtual user kept at most one update
awaiting acknowledgement.

The environment was one compiled NestJS process on an Apple Silicon macOS host,
Node.js 24.13.1, loopback WebSocket without TLS or proxy, and disposable local
PostgreSQL 16 and Redis 7 containers. Application, generator, database, and
Redis shared the same machine.

## Historical results

Shared-document staircase, five updates per user:

| Users | Durable updates | Throughput | Ack p50 | Ack p95 | Ack p99 | Fan-out |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 50 | 369.78/s | 22.84 ms | 33.12 ms | 37.56 ms | 450/450 |
| 25 | 125 | 368.51/s | 64.86 ms | 71.48 ms | 82.58 ms | 3,000/3,000 |
| 50 | 250 | 389.84/s | 120.27 ms | 135.31 ms | 156.70 ms | 12,250/12,250 |
| 100 | 500 | 371.12/s | 270.44 ms | 288.50 ms | 325.81 ms | 49,500/49,500 |

Longer and distributed profiles:

| Profile | Updates | Throughput | Ack p95 / p99 | Peer p95 / p99 | Fan-out |
|---|---:|---:|---:|---:|---:|
| 100 users, 1 document, 20 each | 2,000 | 352.88/s | 333.56 / 351.62 ms | 4.36 / 76.07 ms | 198,000/198,000 |
| 100 users, 10 documents, 3 each | 300 | 1,588.59/s | 71.65 / 77.47 ms | 8.73 / 9.47 ms | 2,700/2,700 |
| 250 users, 25 documents, 5 each | 1,250 | 1,861.50/s | 180.01 / 205.44 ms | 31.04 / 35.04 ms | 11,250/11,250 |

The sustained 100-user profile recorded post-stage RSS of 282.33 MiB and
event-loop p99 of 12.46 ms. The 250-user profile recorded 542.88 MiB and
52.43 ms. These were point-in-time samples, not high-water marks or leak
measurements. The comparable 100-user distributed RSS sample was not retained.

## What the evidence suggests

The hot-document profiles stabilized near 350–390 durable updates per second in
that environment while acknowledgement latency rose with concurrent writers.
This matches the implementation: one document has a local persistence chain
and one PostgreSQL advisory-lock serialization boundary.

Spreading updates across documents produced much higher aggregate throughput
because ordering is scoped per document. Local peer delivery remained much
faster than durable acknowledgement; peers receive an accepted update before
the sender's PostgreSQL commit completes. Peer latency and durable-ack latency
must therefore be measured and interpreted separately.

The run demonstrated completion and expected fan-out for the recorded profiles.
It did not establish a maximum user count or validate production behavior.

## Unmeasured boundaries

The historical run omitted TLS, WAN latency, packet loss, reverse proxies,
sticky load balancing, multiple API replicas, managed dependencies, Redis
failure, process restart, long soak, large updates, heavy awareness/chat, mixed
HTTP or terminal traffic, browser rendering cost, IndexedDB replay, slow
devices, and production monitoring overhead.

Those omissions are especially important because the measured hot-document
limit is a PostgreSQL ordering boundary, while multi-replica live delivery adds
the separate Redis behavior described in
[Scaling and failure model](scaling-and-failure-model.md).

Benchmark setup, safety constraints, command syntax, and workload configuration
belong in the [realtime load-test how-to](../how-to/run-load-test.md), not in
this explanation.
