# Repeated local collaboration benchmark — September 23, 2026

All nine measured runs passed against application/harness revision `396585f`.
The run took place on September 23 in America/New_York (September 24 UTC).
[Raw results, environment, per-run statistics, and harness hash](realtime-benchmark-2026-09-23.json)
are retained alongside this report.

## Representative results

Each profile was measured three times, in round-robin order, after a separate
10/25/50/100-user warm-up. Every user submitted 100 small incremental edits,
with at most one update awaiting durable acknowledgment. These are finite
closed-loop load tests, not long-running soak or production capacity tests.

| Simulated users | Documents | Updates per run | Median updates/s (range) | Median run ack p95 (range) | Median run peer p95 |
|---:|---:|---:|---:|---:|---:|
| 50 | 1 | 5,000 | 400.81 (386.65–404.31) | 150.06 ms (144.59–157.95) | 1.32 ms |
| 100 | 1 | 10,000 | 327.77 (221.56–337.21) | 369.46 ms (342.86–477.10) | 23.03 ms |
| 250 | 25 | 25,000 | 1,725.71 (1,613.47–1,823.36) | 178.60 ms (164.76–220.33) | 10.40 ms |

The percentile column is the median of three independently calculated run p95s,
not a pooled percentile. Timed update phases lasted 12.37–45.13 seconds. Account
provisioning, connection/join, the 500 ms drain, final convergence verification,
and cleanup are outside the update-throughput interval. Connection and join
latencies are retained separately in the JSON.

Across the nine measured runs:

- **120,000 / 120,000 updates durably acknowledged**.
- **4,380,000 / 4,380,000 unique expected incremental peer deliveries**.
- **1,200 / 1,200 simulated client sessions converged** to complete submitted text.
- Zero failed users, server errors, persistence-failure increments, or duplicate
  incremental deliveries.
- 1,550 valid recovery broadcast deliveries were applied and counted separately.
  They do not inflate the incremental-delivery metric.
- All synthetic accounts were removed: the disposable database had zero users
  after the final run.

The 100-user shared-document result had noticeable run-to-run variation; all
three runs are retained, including the slower one. No application performance
optimization was made during this measurement. Changes in workload and harness
mean these results should not be presented as a percentage improvement over July
or September 18.

## Harness corrections

The previous harness could exit successfully despite missing peer fan-out and
counted raw messages without proving that each expected recipient received an
edit. An initial stricter warm-up exposed a second issue: the periodic durability
audit rebroadcasts merged recovery state, so raw messages are not equivalent to
unique peer edits. That excluded diagnostic run was not a product failure or a
measured repetition.

The corrected harness:

1. Correlates incremental update hashes with unique recipient socket IDs.
2. Reports recovery and duplicate messages separately.
3. Applies incoming updates to a real Y.Doc for every simulated client.
4. Independently merges all submitted updates into a reference per document and
   requires each client's final text to match it, rather than merely requiring
   clients to agree with one another.
5. Exits nonzero on missing acknowledgments or peer deliveries, incomplete
   convergence, malformed/cross-document updates, server errors, or persistence
   failures. Twelve harness tests cover the validation behavior and run in CI.

## Environment and limits

- Apple M4, 10 logical CPUs, 16 GiB host RAM; macOS 26.6.2, Node.js 24.13.1.
- One compiled NestJS API and one Node.js generator on the same host; no watch
  compilation during measurement. The generator also runs all simulated Y.Docs.
- Disposable PostgreSQL 16.15 and Redis 7.4.11 in Docker Desktop, with 7.75 GiB
  available to Docker. PostgreSQL `fsync` and `synchronous_commit` were on.
- API bound explicitly to `127.0.0.1:3300`; data-service ports bound to loopback.
  The bootstrap used the same AppModule, configureApp, logger and shutdown hooks,
  omitting development Swagger initialization.
- `NODE_ENV=test`, `E2E_TEST=true`, `LOG_LEVEL=info`, required Redis, default
  snapshot interval of 100 updates, terminals disabled, and no email credentials.
  E2E mode relaxes HTTP and WebSocket throttles; these are not production limits.
- Existing unrelated apps were left running. Unit/integration tests completed
  before load measurement. All repetitions reused the same warmed API process.
- No WAN, public TLS, browser/Monaco rendering, multiple API replicas, terminal
  workloads, large payloads, packet loss, failover, or sustained soak was included.
  Resource statistics are post-stage samples, not peak memory measurements.

Peer delivery can precede PostgreSQL commit. Durable-ack latency includes the
commit; peer latency does not. Neither is editor-render latency. This evidence
does not establish a production user limit or public availability guarantee.

## Other checks rerun

- Server TypeScript compilation: passed.
- Backend unit tests: **459 passed** across 29 suites.
- Frontend unit tests: **52 passed** across 10 files.
- Real database integration tests: **69 passed** across 14 suites, including
  multi-replica collaboration, recovery, permissions and persistence.
- Load-harness tests: **12 passed**.

The full browser suite and production terminal isolation were not rerun in this
benchmark session; their earlier evidence has separate dates and limitations.

## Reproducing the measurement

First provision disposable services and a compiled loopback API as described in
[Run the realtime load test](../../how-to/run-load-test.md). Do not target a
database containing real accounts. Run these commands from `server/`:

```sh
npm run test:load-harness
LOAD_BASE_URL=http://127.0.0.1:3300 LOAD_CONCURRENCY=10,25,50,100 \
  LOAD_UPDATES_PER_USER=5 npm run load:realtime

for repetition in 1 2 3; do
  LOAD_BASE_URL=http://127.0.0.1:3300 LOAD_CONCURRENCY=50 \
    LOAD_USERS_PER_DOCUMENT=0 LOAD_UPDATES_PER_USER=100 npm run load:realtime || break
  LOAD_BASE_URL=http://127.0.0.1:3300 LOAD_CONCURRENCY=100 \
    LOAD_USERS_PER_DOCUMENT=0 LOAD_UPDATES_PER_USER=100 npm run load:realtime || break
  LOAD_BASE_URL=http://127.0.0.1:3300 LOAD_CONCURRENCY=250 \
    LOAD_USERS_PER_DOCUMENT=10 LOAD_UPDATES_PER_USER=100 npm run load:realtime || break
done
```

Preserve each `LOAD_RESULT_JSON` output and compare all repetitions. Do not
substitute the highest throughput or lowest latency for the median.

## Resume wording supported by these measurements

- Benchmarked a collaborative IDE with **250 concurrent simulated users across
  25 documents**, measuring **1.7K durable updates/sec and 179 ms p95 acknowledgment
  latency** using medians from three local runs.
- Validated CRDT collaboration across **120K durably acknowledged edits and
  4.38M unique peer deliveries**, with complete document convergence in all nine
  local benchmark runs.

These describe synthetic local testing, not customer adoption, public-server
performance, or production-scale validation.
