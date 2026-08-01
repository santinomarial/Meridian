# Deploy multiple API replicas

Use multiple replicas only after accepting the current
[scaling and failure model](../explanation/scaling-and-failure-model.md). The bundled
production Compose file defines one API service; setting `API_UPSTREAMS` alone
does not create additional replicas. Supply stable replica addresses through
your platform or a reviewed Compose override.

## 1. Prepare shared dependencies

Provision one shared PostgreSQL database and one private shared Redis
deployment. Restrict Redis to trusted application publishers. Before changing
an existing fleet, take a [database backup](backup-and-restore-database.md) and
stop admitting writes.

Apply committed Prisma migrations once as a release step, before the new
replicas receive traffic. Do not run `prisma migrate dev` or let each replica
apply migrations.

## 2. Configure every replica identically

Use the same application image and set the same values on every replica:

```dotenv
NODE_ENV=production
ENABLE_TERMINAL=false
E2E_TEST=false
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
REDIS_REQUIRED=true
REDIS_KEY_PREFIX=prod:
JWT_SECRET=...
CLIENT_ORIGIN=https://app.example.com
RESEND_API_KEY=...
MAIL_FROM="Meridian <accounts@example.com>"
EMAIL_VERIFICATION_REQUIRED=true
TRUST_PROXY=1
```

Use a unique Redis prefix per Meridian environment. Production rejects terminal
and E2E modes, requires email verification and production mail delivery, and
does not mount Swagger. Give shutdown enough grace for local persistence queues
to drain.

Start the replicas without public traffic. Check each replica's internal
`GET /ready`: it must return HTTP 200 while PostgreSQL and Redis are healthy.
`GET /health` is only a process-liveness check and is not sufficient for
admission.

## 3. Configure sticky load balancing

The load balancer must:

1. Forward WebSocket upgrades.
2. Keep the Socket.IO handshake, HTTP polling, upgrade, and remaining session
   on one replica.
3. Actively probe `GET /ready` and remove non-ready replicas.
4. Preserve credentials and the original HTTPS origin.

The bundled Caddyfile implements cookie affinity. Give Caddy stable,
space-separated upstreams and one stable signing secret:

```dotenv
API_UPSTREAMS=api-a:3000 api-b:3000
LB_COOKIE_SECRET=<stable-random-secret>
```

Changing `LB_COOKIE_SECRET` remaps active sessions. The upstream names must
actually exist on Caddy's network; the repository's base Compose file creates
only `api`.

## 4. Verify before admitting users

Working directory: any directory.

```bash
curl -fsS "https://app.example.com/ready"
```

Replace the hostname before running. It must return HTTP 200. Then:

1. Pin two authenticated browser clients to different replicas using platform
   observability.
2. Edit one document from each client.
3. Confirm peer delivery and a post-commit `yjs:ack` in both directions.
4. Save, reconnect both clients, and verify the saved text.
5. Confirm the load balancer removes a deliberately drained replica and clients
   reconnect without sending polling requests to two backends.

These checks change test data; use a dedicated smoke workspace and remove it
afterward. Do not admit production collaboration if Redis is unhealthy,
affinity is unverified, or any replica differs in build, schema, or
configuration.

See [Scaling and failure model](../explanation/scaling-and-failure-model.md) for
state ownership and dependency behavior, and
[Known limitations](../reference/known-limitations.md) for residual limits.
