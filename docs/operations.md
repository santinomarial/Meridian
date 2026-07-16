# Production operations

This document covers the in-repo production surface for Meridian: containers,
Redis multi-replica gates, metrics, backups, SPA CSP, and incident runbooks.
It is not a cloud vendor manifest — sticky load balancing, TLS, secrets, and
managed Postgres/Redis still come from your platform.

## Containers

| Artifact | Role |
|---|---|
| [`server/Dockerfile`](../server/Dockerfile) | Non-root API image (`uid 10001`), multi-stage build, `tini` entrypoint |
| [`client/Dockerfile`](../client/Dockerfile) + [`client/nginx.conf`](../client/nginx.conf) | Non-root nginx SPA host on port 8080 with baseline CSP |
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | Sketch: Postgres, Redis, one-shot `migrate` job, API (`REDIS_REQUIRED`), web |

```bash
export POSTGRES_PASSWORD=... JWT_SECRET=... CLIENT_ORIGIN=https://app.example.com
docker compose -f docker-compose.prod.yml up --build
```

The migrate service runs `npx prisma migrate deploy` once and exits. The API
depends on a successful migrate. Do not run `prisma migrate dev` in production.

## Redis for multi-replica

| Variable | Default | Meaning |
|---|---|---|
| `REDIS_REQUIRED` | `false` | When `true`, `GET /ready` returns 503 unless Redis is `ok` |
| `REDIS_KEY_PREFIX` | empty | Prefix for every Redis key and pub/sub channel (`prod` → `prod:`) |

Use a non-empty prefix whenever staging and production share Redis, or when
multiple Meridian fleets share one cluster.

The Redis clients reconnect with capped exponential backoff and re-issue
`PSUBSCRIBE` for registered patterns after reconnect. Publish failures remain
fail-closed (no offline queue). See [Redis loss runbook](runbooks/redis-loss.md).

Single-replica deployments can leave `REDIS_REQUIRED=false`. Multi-replica
collaborative fleets should set `REDIS_REQUIRED=true` and gate traffic on
`/ready`.

## Metrics

With `METRICS_ENABLED=true` (default), scrape:

```text
GET /metrics
```

Process-local Prometheus metrics include:

- `meridian_persistence_commits_total` / `_failures_total` / `_fenced_total`
- `meridian_persistence_write_chains`
- `meridian_documents_loaded`
- `meridian_sockets_active`
- `meridian_pty_sessions`
- `meridian_sandboxes_active`
- default Node process metrics from `prom-client`

Expose `/metrics` only on an internal scrape network. Pair with your
OpenTelemetry collector or Prometheus federation as needed; the application
does not ship an OTLP exporter.

## Sticky load balancing

Socket.IO rooms, PTYs, and in-memory Y.Docs are process-local. Any multi-replica
HTTP/WebSocket LB must:

1. Support WebSocket upgrade.
2. Stick long-polling and upgrade traffic for a connection to one API replica
   (cookie or consistent-hash affinity).
3. Health-check `GET /ready` (not only `/health`) so Redis-required fleets drain
   when Redis is down.

## SPA Content-Security-Policy

The API Helmet config leaves CSP off (JSON API). The client nginx image sets a
baseline CSP. Before production:

- Set `connect-src` to your API origin(s) and `wss:` endpoint explicitly.
- Prefer a nonce/hash for any inline bootstrap if you remove `'unsafe-inline'`
  from `style-src`.
- Terminate TLS (and HSTS) at the edge in front of nginx.

## Backups and restore

PostgreSQL is the durability boundary. Minimum practice:

1. Continuous or daily `pg_dump` / managed snapshots of the Meridian database.
2. Test restore into an isolated instance before you need it
   ([`server/scripts/backup-pg.sh`](../server/scripts/backup-pg.sh)).
3. After restore, restart the **entire** API fleet so in-memory Y.Docs and Redis
   seq seed flags cannot diverge from the restored lineage.
4. Redis AOF/RDB is optional acceleration — do not treat Redis as the restore
   source for documents.

CI validates that the backup script can dump and restore schema+data against
the integration Postgres service (see the `ops-backup` job).

## Vulnerability scanning

CI runs `npm audit --omit=dev` for server and client lockfiles (high+), and
Trivy against the production Dockerfiles when Compose artifacts change.

## Related runbooks

- [Redis loss / fan-out outage](runbooks/redis-loss.md)
- [Document divergence](runbooks/document-divergence.md)
- [Horizontal scaling](scaling.md)
