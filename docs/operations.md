# Production operations

This document covers the in-repo production surface for Meridian: containers,
Caddy TLS edge, Redis multi-replica gates, metrics, backups, SPA CSP, and
incident runbooks. The default public path is **one VPS + Docker Compose +
Caddy** (single API replica). Multi-replica sticky LB fleets remain optional
and are covered under Sticky load balancing below.

## Containers

| Artifact | Role |
|---|---|
| [`server/Dockerfile`](../server/Dockerfile) | Non-root API image (`uid 10001`), multi-stage build, `tini` entrypoint |
| [`client/Dockerfile`](../client/Dockerfile) + [`client/nginx.conf`](../client/nginx.conf) | Non-root nginx SPA on 8080; same-origin CSP + optional `CSP_CONNECT_SRC_EXTRA` |
| [`deploy/Caddyfile`](../deploy/Caddyfile) | Public TLS edge: HSTS, API + Socket.IO proxy, SPA fallback; blocks `/metrics` |
| [`docker-compose.prod.yml`](../docker-compose.prod.yml) | Postgres, Redis, migrate, API, web, Caddy (only 80/443 published) |
| [`.env.production.example`](../.env.production.example) | VPS env template (no secrets) |

```bash
cp .env.production.example .env   # fill DOMAIN, CLIENT_ORIGIN, JWT_SECRET, POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up --build -d
```

The migrate service runs `npx prisma migrate deploy` once and exits. The API
depends on a successful migrate. Do not run `prisma migrate dev` in production.

## Public deploy

Recommended topology: **one VPS**, **one API replica**, Caddy terminates HTTPS,
SPA and API share the same origin (`https://YOUR_DOMAIN`). Terminal stays
disabled (`ENABLE_TERMINAL` is refused when `NODE_ENV=production`).

```text
Users --HTTPS--> Caddy :443 --> web:8080 (SPA)
                            \-> api:3000 (REST + /socket.io)
API --> Postgres (internal)
API --> Redis (internal)
```

### Phase 1 - Harden before opening DNS / firewall to the world

**Secrets and identity**

- Generate new production secrets (never reuse laptop `.env` or Resend test keys):
  - `JWT_SECRET` at least 32 random bytes (`openssl rand -base64 48`)
  - `POSTGRES_PASSWORD` strong random
  - Unique `REDIS_KEY_PREFIX` (e.g. `prod:`)
- Set `CLIENT_ORIGIN=https://YOUR_DOMAIN`
- Set `DOMAIN=YOUR_DOMAIN` and optional `ACME_EMAIL` for Let's Encrypt
- Leave `VITE_API_URL` / `VITE_SOCKET_URL` empty for same-origin, or set both to
  `https://YOUR_DOMAIN`
- Keep `ENABLE_TERMINAL` unset/false; compose forces `"false"`
- Keep `TRUST_PROXY=1` behind Caddy (compose sets this)
- Do **not** publish Postgres, Redis, or API port 3000 on the host; compose
  only publishes Caddy `80`/`443`. Scrape `/metrics` over SSH tunnel / private
  network only (Caddy returns 404 for `/metrics` publicly)
- Swagger `/docs` stays off in production; Caddy also blocks `/docs` and `/e2e`

**App hardening already in-repo (verify, do not reinvent)**

- HttpOnly auth cookie, `Secure` in production, Helmet on the API
- Invite tokens hashed at rest; single-use accept
- Non-root containers in server/client Dockerfiles
- SPA CSP defaults to `connect-src 'self'` for same-origin public HTTPS

**Known residual risks (accept or mitigate)**

- No email verification at signup; treat addresses as unverified until you add that flow
- Invite email to arbitrary inboxes needs a **verified Resend domain**; until then use copy-link only
- Process-local HTTP throttling; add edge rate limits if you expect abuse
- Terminal must stay disabled for multi-tenant public use

**Host hardening (VPS)**

- Fresh Ubuntu LTS; non-root sudo user; SSH keys only (disable password auth)
- `ufw` allow `22`/`80`/`443` only; enable unattended security updates; fail2ban on SSH
- Install Docker Engine + Compose plugin
- Never bind Postgres/Redis to `0.0.0.0`

### Phase 2 - DNS and bring-up

1. Point DNS `A` / `AAAA` for `YOUR_DOMAIN` at the VPS; wait for propagation.
2. On the VPS, from the repo root:

```bash
cp .env.production.example .env
# edit .env: DOMAIN, CLIENT_ORIGIN, JWT_SECRET, POSTGRES_PASSWORD, REDIS_KEY_PREFIX
docker compose -f docker-compose.prod.yml up --build -d
```

3. Caddy obtains certificates automatically for `DOMAIN`.

### Phase 3 - Go-live checklist

1. `https://YOUR_DOMAIN/ready` returns 200
2. Sign up, create file, share copy-link, accept invite in a second browser, and live edit
3. Confirm auth cookies are `Secure` over HTTPS; no mixed content in DevTools
4. Enable Postgres backups (daily `pg_dump` or provider snapshots); test one restore
   ([`server/scripts/backup-pg.sh`](../server/scripts/backup-pg.sh))
5. Optional: verify a Resend domain and set `RESEND_API_KEY` + `MAIL_FROM` for real invite/reset email

## Redis for multi-replica

| Variable | Default | Meaning |
|---|---|---|
| `REDIS_REQUIRED` | `false` | When `true`, `GET /ready` returns 503 unless Redis is `ok` |
| `REDIS_KEY_PREFIX` | empty | Prefix for every Redis key and pub/sub channel (`prod` becomes `prod:`) |

Use a non-empty prefix whenever staging and production share Redis, or when
multiple Meridian fleets share one cluster. The public Compose stack sets
`REDIS_REQUIRED=true` and `REDIS_KEY_PREFIX` from `.env`.

The Redis clients reconnect with capped exponential backoff and re-issue
`PSUBSCRIBE` for registered patterns after reconnect. Publish failures remain
fail-closed (no offline queue). See [Redis loss runbook](runbooks/redis-loss.md).

Single-replica deployments outside Compose can leave `REDIS_REQUIRED=false`.
Multi-replica collaborative fleets should set `REDIS_REQUIRED=true` and gate
traffic on `/ready`.

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

Expose `/metrics` only on an internal scrape network (SSH tunnel to the API
container, or a private overlay). Caddy's public Caddyfile returns **404** for
`/metrics`. Pair with your OpenTelemetry collector or Prometheus federation as
needed; the application does not ship an OTLP exporter.

## Sticky load balancing

Socket.IO rooms, PTYs, and in-memory Y.Docs are process-local. The default
public Compose deploy uses **one API replica** so sticky LB is unnecessary.
Any multi-replica HTTP/WebSocket LB must:

1. Support WebSocket upgrade.
2. Stick long-polling and upgrade traffic for a connection to one API replica
   (cookie or consistent-hash affinity).
3. Health-check `GET /ready` (not only `/health`) so Redis-required fleets drain
   when Redis is down.

## SPA Content-Security-Policy

The API Helmet config leaves CSP off (JSON API). The client nginx image sets CSP
at build time:

- Default public same-origin: `connect-src 'self'`
- Google Fonts are allowed on `style-src` / `font-src` for the SPA
- If the API is on a separate origin, rebuild web with
  `CSP_CONNECT_SRC_EXTRA= https://api.example.com wss://api.example.com`
  (leading space required)
- Prefer a nonce/hash for any inline bootstrap if you remove `'unsafe-inline'`
  from `style-src`
- TLS and HSTS terminate at Caddy (`deploy/Caddyfile`), not in the SPA container

## Backups and restore

PostgreSQL is the durability boundary. Minimum practice:

1. Continuous or daily `pg_dump` / managed snapshots of the Meridian database.
2. Test restore into an isolated instance before you need it
   ([`server/scripts/backup-pg.sh`](../server/scripts/backup-pg.sh)).
3. After restore, restart the **entire** API fleet so in-memory Y.Docs and Redis
   seq seed flags cannot diverge from the restored lineage.
4. Redis AOF/RDB is optional acceleration; do not treat Redis as the restore
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
