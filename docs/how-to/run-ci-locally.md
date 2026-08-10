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
GitHub scans all three images with its pinned Trivy action; reproduce that with
the organization's approved Trivy installation rather than assuming the hosted
action is installed locally.

Validate the same monitoring configurations with their native tools:

```bash
docker run --rm --entrypoint promtool \
  -v "$PWD/deploy/monitoring:/etc/prometheus:ro" \
  prom/prometheus:v3.13.2 \
  check config /etc/prometheus/prometheus.yml
docker run --rm --entrypoint amtool \
  -v "$PWD/deploy/monitoring:/etc/alertmanager:ro" \
  prom/alertmanager@sha256:a42c3e2e8f7cd4fd3a0ce1bd593ca5abe965c97b993476007d6f69c4a2aa33b5 \
  check-config /etc/alertmanager/alertmanager.yml
```

Both commands must report a valid configuration. CI also scans these exact
Prometheus and Alertmanager images for high and critical vulnerabilities.

## Operational script checks

Working directory: repository root. Install `shellcheck`, then run:

```bash
bash -n server/scripts/backup-pg.sh scripts/backup-compose.sh \
  scripts/backup-offsite-restic.sh
shellcheck server/scripts/backup-pg.sh scripts/backup-compose.sh \
  scripts/backup-offsite-restic.sh scripts/smoke-containers.sh
```

Both commands must exit without output. The backup job additionally exercises
the database dump/restore round trip and verifies that the automated backup
fails closed when its required offsite hook is missing.

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
