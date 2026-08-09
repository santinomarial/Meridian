# CI jobs

Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

- Triggers: pushes to `main` and all pull requests.
- Runtime: GitHub-hosted `ubuntu-latest`, Node.js 22.
- Permissions: `contents: read`.
- Concurrency group: `ci-${{ github.ref }}`; superseded runs are cancelled.

| Job ID | Display name | Services | Commands and checks |
|---|---|---|---|
| `server` | Server (build + unit tests) | None | `npm ci`, `npx prisma generate`, `npm run build`, `npm test` in `server/` |
| `client` | Client (typecheck + unit tests + build) | None | `npm ci`, `npx tsc -b`, `npm test`, `npm run build` in `client/` |
| `server-integration` | Server (integration + multi-replica) | PostgreSQL 16, Redis 7 | `npm ci`, Prisma generate, `prisma migrate deploy`, serial integration suite |
| `e2e` | E2E (Playwright) | PostgreSQL 16, Redis 7 | Migrate/build/start API, install client and Chromium, run Playwright; API uses `E2E_TEST=true` and `ENABLE_TERMINAL=true` |
| `lint` | Lint | None | `npm ci`, `npm run lint` in `client/` |
| `security-audit` | Dependency audit | None | Production-only `npm audit --audit-level=high` for both lockfiles |
| `container-scan` | Container scan (Trivy) | None | Build application images; validate monitoring configs; scan app, Prometheus, and Alertmanager images for high/critical findings |
| `ops-backup` | Backup/restore smoke | PostgreSQL 16 | Build/run migration image, dump and restore PostgreSQL, verify `_prisma_migrations`, and exercise the required off-host hook contract |

## Service and test environment

`server-integration` uses a real request pipeline and does **not** set
`E2E_TEST`; it exercises normal throttling and hidden E2E routes. Its
multi-replica specs boot two application modules against shared PostgreSQL and
Redis.

`e2e` sets:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Local CI PostgreSQL database |
| `REDIS_URL` | `redis://localhost:6379` |
| `JWT_SECRET` | CI-only test secret |
| `CLIENT_ORIGIN` | `http://localhost:5173` |
| `NODE_ENV` | `development` |
| `E2E_TEST` | `true` |
| `ENABLE_TERMINAL` | `true` |
| `MERIDIAN_BACKEND_URL` | `http://localhost:3000` |

Failure artifacts are limited to the Playwright HTML report, retained for seven
days. For broader system context, see the
[system overview](../explanation/system-overview.md) and
[server architecture](../explanation/server-architecture.md).
