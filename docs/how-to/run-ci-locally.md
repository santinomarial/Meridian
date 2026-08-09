# Run CI checks locally

There is no root package script. Run the same package commands used by
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) from their stated
directories.

## Server job

Working directory: `server/`.

```bash
npm ci
npx prisma generate
npm run build
npm test
```

The build and Jest summary must finish without errors or failed tests.

## Client and lint jobs

Working directory: `client/`.

```bash
npm ci
npx tsc -b
npm test
npm run build
npm run lint
```

Vitest and ESLint must report no failures, and Vite must create `dist/`.
`npm run build` repeats the project TypeScript build; this matches the separate
CI checks.

## Dependency audit

Working directory: `server/`.

```bash
npm audit --omit=dev --audit-level=high
```

Working directory: `client/`.

```bash
npm audit --omit=dev --audit-level=high
```

Both commands must exit 0. Audit results depend on the live npm advisory
database and can differ from an earlier CI run.

## Production container checks

Working directory: repository root.

```bash
docker build -t meridian-api:ci ./server
docker build --target migrate -t meridian-migrate:ci ./server
docker build -t meridian-web:ci ./client
bash scripts/smoke-containers.sh
```

These builds consume local Docker space and execute the production runtime
smoke checks. The script must end with `Container runtime smoke tests passed`.
GitHub also scans all three images with its pinned Trivy action; reproduce that
with the organization's approved Trivy installation rather than assuming the
hosted action is installed locally. It also validates and scans the pinned
Prometheus and Alertmanager images and their committed configurations.

## Service-backed jobs

- Run [server integration tests](run-server-tests.md#integration-and-multi-replica-tests)
  against disposable PostgreSQL and Redis.
- Run [browser E2E tests](run-e2e-tests.md) against the isolated E2E server.
- Run a [backup/restore drill](backup-and-restore-database.md#test-a-restore)
  against an empty database.

These jobs migrate or write database state. Verify every connection string
before running them. A local pass does not replace the final GitHub Actions run,
whose service containers, Linux native modules, Playwright dependencies, and
Trivy environment can differ from the workstation.
