# Containers and Compose

## Development Compose

File: [`server/docker-compose.yml`](../../../server/docker-compose.yml).

| Service | Image | Host port | Data |
|---|---|---:|---|
| `postgres` | `postgres:16` | 5432 | `postgres_data` volume; database `meridian`, user/password `postgres` |
| `redis` | `redis:7` | 6379 | `redis_data` volume |

The development file defines no health checks and no application service.
`npm run infra:up` and `npm run infra:down` run this Compose file from
`server/`.

## Server image

File: [`server/Dockerfile`](../../../server/Dockerfile).

| Stage/target | Base | Contents and command |
|---|---|---|
| `dependencies` | `node:22-alpine3.24` | Build toolchain, lockfile install, Prisma and scripts |
| `build` | dependencies | Prisma generate, Nest build, production dependency prune |
| `runtime-base` | `node:22-alpine3.24` | `tini`, OpenSSL/CAs, non-login uid/gid 10001; npm/Corepack removed |
| `migrate` | runtime-base | Prisma CLI/client/schema only; `prisma migrate deploy` |
| `runtime` (default) | runtime-base | Compiled API, production dependencies, Prisma schema; `node dist/main.js` |

Both runnable targets use the `meridian` non-root user. The API exposes 3000.
The image sets `NODE_ENV=production`, `PORT=3000`, and `SHELL=/bin/sh`.

## Client image

File: [`client/Dockerfile`](../../../client/Dockerfile).

| Stage | Base | Action |
|---|---|---|
| `build` | `node:22-alpine3.24` | `npm ci`, TypeScript/Vite build |
| `runtime` | `nginx:1.31-alpine3.24-slim` | Serve `dist/` on 8080 as non-root `meridian` |

Build arguments:

| Argument | Default | Stage |
|---|---|---|
| `VITE_API_URL` | empty | Vite build |
| `VITE_SOCKET_URL` | empty | Vite build |
| `CSP_CONNECT_SRC_EXTRA` | empty | Nginx configuration generation |

Nginx applies SPA fallback to `index.html`, marks `index.html` `no-store`, and
marks matching static assets immutable for seven days. See
[client CSP](../client/csp.md).

## Production Compose

File: [`docker-compose.prod.yml`](../../../docker-compose.prod.yml).

| Service | Network exposure | Dependency/order |
|---|---|---|
| `postgres` | Internal 5432 only | Health checked with `pg_isready`; persistent volume |
| `redis` | Internal 6379 only | AOF enabled; health checked; persistent volume |
| `migrate` | Internal, one-shot | Waits for PostgreSQL; runs server `migrate` target |
| `api` | Internal 3000 only | Waits for migration, PostgreSQL, Redis; `/ready` health check |
| `web` | Internal 8080 only | Built with client arguments; waits for healthy API |
| `caddy` | Publishes TCP 80/443 and UDP 443 | Waits for API health and web start |

Named volumes are `postgres_data`, `redis_data`, `caddy_data`, and
`caddy_config`. Only Caddy publishes host ports.

Required Compose inputs:

| Variable | Use |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password and generated API/migration URL |
| `JWT_SECRET` | API signing secret |
| `CLIENT_ORIGIN` | API CORS and generated links |
| `DOMAIN` | Caddy public hostname |
| `ACME_EMAIL` | Caddy ACME contact; the committed Caddyfile always emits this directive |
| `LB_COOKIE_SECRET` | Caddy affinity-cookie signing |

Optional/defaulted Compose inputs:

| Variable | Default |
|---|---|
| `REDIS_KEY_PREFIX` | `prod:` |
| `RESEND_API_KEY` | empty |
| `MAIL_FROM` | empty (passed as an explicit empty string) |
| `VITE_API_URL`, `VITE_SOCKET_URL` | empty |
| `CSP_CONNECT_SRC_EXTRA` | empty |
| `API_UPSTREAMS` | `api:3000` |

The API service fixes `NODE_ENV=production`, `PORT=3000`,
`REDIS_REQUIRED=true`, `TRUST_PROXY=1`, `METRICS_ENABLED=true`, and
`ENABLE_TERMINAL=false`.

## Caddy routing

File: [`deploy/Caddyfile`](../../../deploy/Caddyfile).

- `/metrics`, `/docs`, `/docs/*`, `/e2e`, and `/e2e/*` return 404 at the edge.
- Auth, users, workspaces, documents, invites, health, readiness, and
  `/socket.io` paths proxy to `API_UPSTREAMS`.
- All remaining paths proxy to `web:8080`.
- API routing uses a signed `meridian_affinity` cookie, active `/ready` checks,
  passive failure checks, and brief connection retries.
- Caddy terminates TLS, enables zstd/gzip, sends one-year HSTS and common
  security headers, removes the `Server` header, and logs to stdout.

The application itself also omits Swagger in production. For operational
context and failure behavior, see the
[system overview](../../explanation/system-overview.md),
[trust boundaries](../../explanation/trust-boundaries.md), and
[scaling/failure model](../../explanation/scaling-and-failure-model.md).
