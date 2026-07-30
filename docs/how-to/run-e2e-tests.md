# Run browser end-to-end tests

The complete Playwright suite needs an isolated non-production API, migrated
PostgreSQL, Redis, and terminal support. `E2E_TEST=true` exposes unauthenticated,
scope-limited cleanup/reset helpers and raises rate limits; never use this mode
with production data or an untrusted network.

## 1. Start the test backend

Ensure `server/.env` points to the disposable local services.

Working directory: `server/`.

```bash
npm ci
npm run infra:up
docker compose exec postgres pg_isready -U postgres
docker compose exec redis redis-cli ping
npx prisma generate
npx prisma migrate deploy
```

PostgreSQL must report `accepting connections` and Redis must print `PONG`.
Migration deploy changes the configured database; stop if `DATABASE_URL` is not
the disposable test database.

Keep this terminal running:

Working directory: `server/`.

```bash
E2E_TEST=true ENABLE_TERMINAL=true NODE_ENV=development npm run start:dev
```

Startup must complete on port 3000. Production validation rejects both enabled
flags, so do not change `NODE_ENV` to production.

In another terminal, check the backend:

Working directory: any directory.

```bash
curl -fsS http://localhost:3000/ready
```

The request must return HTTP 200 before Playwright starts.

## 2. Run Playwright

Working directory: `client/`.

```bash
npm ci
npx playwright install chromium
MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e
```

Playwright starts or reuses Vite at `http://localhost:5173` and runs one Chromium
worker. The final summary must report no failures. If backend-dependent groups
skip because the API is unreachable, the complete suite did not run; fix the
backend and repeat.

For non-default ports, keep `MERIDIAN_BACKEND_URL`, `VITE_API_URL`, and
`VITE_SOCKET_URL` aligned.

## 3. Clean up

Stop the server with `Ctrl-C`, then:

Working directory: `server/`.

```bash
npm run infra:down
```

This retains named volumes. Review server logs if Playwright reports cleanup
failures; do not assume an interrupted run removed every synthetic account.

See [Client commands](../reference/client/commands.md) and
[Server configuration](../reference/server/configuration.md#browser-e2e-scope)
for runner and environment reference.
