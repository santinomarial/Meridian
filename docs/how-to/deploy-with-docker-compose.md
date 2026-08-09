# Deploy with Docker Compose

Use this procedure for the supported one-VPS topology: one API replica, the
bundled PostgreSQL and Redis services, the SPA, and Caddy on ports 80/443.

## 1. Prepare the host

Install Docker Engine with Compose v2, clone Meridian, point the deployment
hostname's DNS records at the host, and allow inbound TCP 80/443. Keep
PostgreSQL, Redis, API port 3000, and web port 8080 private.

Working directory: repository root.

```bash
test ! -e .env && cp .env.production.example .env
openssl rand -base64 48
openssl rand -base64 32
openssl rand -hex 32
```

The first command should produce no output. If it fails, preserve and review the
existing `.env` instead of overwriting it. Put the three generated values in
`.env` as `JWT_SECRET`, `POSTGRES_PASSWORD`, and `LB_COOKIE_SECRET`.

Set these required values:

- `DOMAIN`: public hostname only, such as `app.example.com`.
- `ACME_EMAIL`: monitored address used by Caddy for ACME registration and
  certificate notices.
- `CLIENT_ORIGIN`: exact HTTPS origin, such as `https://app.example.com`.
- `JWT_SECRET`: at least 16 characters; use the generated 48-byte value.
- `POSTGRES_PASSWORD`: strong generated database password.
- `LB_COOKIE_SECRET`: stable secret used to sign Caddy's affinity cookie.
- `RESEND_API_KEY`: restricted production Resend credential.
- `MAIL_FROM`: sender on a verified custom domain, such as
  `Meridian <accounts@example.com>`.
- `MAIL_TIMEOUT_MS`: maximum duration of one Resend request; keep the `10000`
  millisecond default unless measured provider latency requires a change.

Create the paging webhook secret before enabling monitoring. The endpoint must
accept Alertmanager's standard webhook payload and page the on-call responder:

```bash
install -d -m 700 secrets
install -m 600 /dev/null secrets/alertmanager-webhook-url
${EDITOR:-vi} secrets/alertmanager-webhook-url
test "$(wc -l < secrets/alertmanager-webhook-url)" -eq 1
```

Keep `secrets/` out of backups and source control. The committed `.gitignore`
excludes it. For a different host path, set `ALERTMANAGER_WEBHOOK_URL_FILE`.

Leave `API_UPSTREAMS=api:3000`, `VITE_API_URL`, and `VITE_SOCKET_URL` at their
same-origin defaults. Production must keep `ENABLE_TERMINAL=false` and
`E2E_TEST=false`; the former is forced by Compose and either true value is
rejected by production validation. Compose also forces email verification on;
the API refuses to start without working mail configuration. Swagger is not
mounted in production.

## 2. Validate and start

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.prod.yml ps --all
```

`config --quiet` should exit with no output. Bring-up builds the images and runs
the one-shot `migrate` service; it changes the production schema, so take a
database backup before upgrading an existing deployment. `ps` should show
PostgreSQL, Redis, API, web, and Caddy running/healthy and `migrate` exited with
status 0. If not, inspect the failed service:

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml logs migrate api caddy
```

Do not use `prisma migrate dev` in production.

PostgreSQL, Redis, API, web, and Caddy use `restart: unless-stopped`, so Docker
restarts them after process failure or daemon/host restart. Reboot the host once
before go-live and confirm that all five long-running services recover without
manual intervention.

## 3. Verify the public service

Working directory: repository root.

```bash
curl -fsS "https://app.example.com/health"
curl -fsS "https://app.example.com/ready"
curl -sS -o /dev/null -w '%{http_code}\n' "https://app.example.com/docs"
```

Replace the hostname before running. `/health` and `/ready` must return HTTP
200. The API container and Caddy both probe `/ready`; with this stack,
readiness requires PostgreSQL and Redis. `/docs` must print `404`, confirming
that Swagger is absent and blocked at the edge.

Complete a browser smoke test: register, verify the email address, create and
save a file, reconnect, and confirm the file remains. Also verify that the
registration session is not created before mailbox verification and that the
same verification link cannot be reused. Then configure and test
[database backups](backup-and-restore-database.md).

## 4. Establish operational readiness

Start the repository-owned Prometheus, Alertmanager, and alert rules:

```bash
docker compose --profile monitoring -f docker-compose.prod.yml up -d alertmanager prometheus
curl -fsS http://127.0.0.1:9090/-/ready
curl -fsS http://127.0.0.1:9093/-/ready
```

Both monitoring ports are bound to host loopback only. Inspect them through an
SSH tunnel; do not expose either publicly. The committed rules cover API scrape
loss, persistence failures, restore fencing, and sustained write chains.
Alertmanager groups notifications, repeats critical alerts every 30 minutes,
and sends resolved notifications. Trigger a controlled test alert and verify
that the receiver pages a human before declaring monitoring ready.

Caddy intentionally returns 404 for public `/metrics`. Add host/container CPU,
memory, disk, backup-freshness, and restart alerts in the infrastructure
monitoring system. Exercise the Redis-loss and database-restore procedures
before go-live.

Use [Health and metrics](../reference/server/health-and-metrics.md) for metric
names and [Scaling and failure model](../explanation/scaling-and-failure-model.md)
for dependency behavior.

See [Containers and Compose](../reference/operations/containers-and-compose.md)
for the artifact and routing reference.
