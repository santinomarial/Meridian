# Run server tests

Use Node.js 22 and the committed lockfile. Run all commands in this guide from
`server/`.

## Unit tests

Working directory: `server/`.

```bash
npm ci
npx prisma generate
npm run build
npm test
```

These commands mirror the CI server job. Unit tests mock infrastructure; the
final Jest summary must report no failed suites or tests.

## Integration and multi-replica tests

Use only a disposable database and Redis. The suite creates and removes
synthetic users, but an interrupted run can leave data behind.

Working directory: `server/`.

```bash
npm run infra:up
docker compose exec postgres pg_isready -U postgres
docker compose exec redis redis-cli ping
npx prisma migrate deploy
npm run test:integration
```

Wait for `pg_isready` to report `accepting connections` and Redis to print
`PONG`. Migration deploy changes the selected database schema; stop if
`DATABASE_URL` does not identify the disposable test database. The integration
command runs serially and must finish with no failed suites.

To run only the dedicated multi-replica/fencing coverage:

Working directory: `server/`.

```bash
npm run test:integration -- --testPathPattern='multi-replica|restore-fencing'
```

The focused run must include both matching integration specs and report no
failures.

When finished:

Working directory: `server/`.

```bash
npm run infra:down
```

This stops the local services but intentionally retains named volumes. Do not
add `--volumes` unless deleting that local database is explicitly intended.

See [Server commands](../reference/server/commands.md) for package command
scope.
