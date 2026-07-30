# Run the realtime load test

The harness creates real accounts, memberships, documents, updates, and
snapshots. Run it only against a disposable or explicitly authorized
environment. A killed process can prevent cleanup.

## 1. Start an isolated API on port 3000

Prepare migrated disposable PostgreSQL and Redis services as described in
[Run server tests](run-server-tests.md#integration-and-multi-replica-tests),
then build the API.

Working directory: `server/`.

```bash
npm ci
npx prisma generate
npm run build
```

Keep this terminal running:

Working directory: `server/`.

```bash
NODE_ENV=development E2E_TEST=true ENABLE_TERMINAL=false METRICS_ENABLED=true PORT=3000 npm run start:prod
```

E2E mode avoids test traffic being rejected by normal rate limits; it also
exposes test helpers, so keep this disposable process off untrusted networks.

Verify both required endpoints:

Working directory: any directory.

```bash
curl -fsS http://127.0.0.1:3000/ready
curl -fsS http://127.0.0.1:3000/metrics > /dev/null
```

Both commands must exit 0. The public Caddy route blocks `/metrics`, so target
the API directly.

## 2. Run the default stages

Working directory: `server/`.

```bash
LOAD_BASE_URL=http://127.0.0.1:3000 npm run load:realtime
```

Always set `LOAD_BASE_URL` explicitly. The normal server listens on 3000, while
the script's internal fallback is 3100. Use the fallback only when the server
was intentionally started with `PORT=3100`:

Working directory: `server/`.

```bash
LOAD_BASE_URL=http://127.0.0.1:3100 npm run load:realtime
```

The run must print the selected target, stage summaries, and a final
`LOAD_RESULT_JSON=...` record. Check for zero failed users, all expected durable
updates, no persistence-failure delta, and complete expected fan-out. Preserve
the JSON with the server build and test-environment details.

For 250 users split across documents:

Working directory: `server/`.

```bash
LOAD_BASE_URL=http://127.0.0.1:3000 \
LOAD_CONCURRENCY=250 \
LOAD_USERS_PER_DOCUMENT=10 \
LOAD_UPDATES_PER_USER=5 \
npm run load:realtime
```

This can consume substantial database, memory, and CPU capacity. Watch the
target and stop only if safety requires it; afterward, inspect for synthetic
`load-*` accounts because forced termination can bypass cleanup.

The harness refuses non-loopback hosts unless `LOAD_ALLOW_REMOTE=true`. Do not
override that guard without an approved load-test and cleanup plan.

See [Performance baseline](../explanation/performance-baseline.md) for
methodology and interpretation limits, and
[Server configuration](../reference/server/configuration.md#realtime-load-scope)
for the variable reference.
