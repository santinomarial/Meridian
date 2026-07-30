# Health and metrics

## `GET /health`

Public liveness endpoint. It does not query PostgreSQL or Redis.

```text
status: "ok"
service: "meridian-server"
timestamp: ISO-8601 string
uptime: process uptime in seconds
```

Success status is 200.

## `GET /ready`

Public readiness endpoint. PostgreSQL and Redis checks run concurrently with a
two-second timeout each.

Successful response:

```text
status: "ready"
dependencies.postgres: "ok"
dependencies.redis: "ok" | "error" | "disabled"
timestamp: ISO-8601 string
```

Readiness rules:

| Condition | HTTP status |
|---|---:|
| PostgreSQL `ok`; `REDIS_REQUIRED=false` | 200, regardless of Redis state |
| PostgreSQL `ok`; `REDIS_REQUIRED=true`; Redis `ok` | 200 |
| PostgreSQL error | 503 |
| Redis not `ok` while `REDIS_REQUIRED=true` | 503 |

The controller throws the detailed `not_ready` object, but the global exception
filter masks all 5xx response details. The caller therefore receives the
standard 503 internal-error envelope rather than dependency fields.

## `GET /metrics`

`METRICS_ENABLED=true` exposes Prometheus text format with:

| Metric | Type | Meaning |
|---|---|---|
| `meridian_persistence_commits_total` | Counter | Durable Yjs updates committed |
| `meridian_persistence_failures_total` | Counter | Persistence failures |
| `meridian_persistence_fenced_total` | Counter | Writes rejected by restore generation fencing |
| `meridian_persistence_write_chains` | Gauge | Documents with local in-flight persistence chains |
| `meridian_documents_loaded` | Gauge | Process-local in-memory Yjs documents |
| `meridian_sockets_active` | Gauge | Authenticated sockets registered on this process |
| `meridian_pty_sessions` | Gauge | Active process-local PTYs |
| `meridian_sandboxes_active` | Gauge | Active terminal sandbox registrations |
| Node/process defaults | Counters/gauges | `prom-client` default runtime metrics |

The endpoint sends `Cache-Control: no-store` and Prometheus content type.
`METRICS_ENABLED=false` returns 404.

All three routes skip the stricter `auth` throttler but retain the default HTTP
throttler. Production Caddy routes `/health` and `/ready` to the API but returns
404 for public `/metrics`. Scrape the API over an internal path.

Swagger is available only outside production. See
[containers and Compose](../operations/containers-and-compose.md) and
[server architecture](../../explanation/server-architecture.md).
