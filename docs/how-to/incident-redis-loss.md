# Respond to Redis loss

Use this runbook when Redis is unavailable or cross-replica fan-out is failing.
In a multi-replica deployment, treat any Redis loss as a collaborative outage
even though acknowledged PostgreSQL writes may continue.

## 1. Contain

1. Declare an incident and page the application and data owners.
2. Ask users to copy visibly unsaved text locally. If the incident owner
   confirms a controlled sticky session is still coherent, allow a brief
   preservation window for those users to Save/checkpoint; do not claim that
   cross-replica state is coherent during the outage.
3. Then stop admitting mutations and Socket.IO collaboration at the load
   balancer. Fail closed on `/ready`; do not leave a mixed fleet where only
   some replicas can use Redis.
4. Gracefully drain or stop every API replica. Allow persistence queues time to
   finish; do not use `SIGKILL` unless host safety requires it.

For the bundled Compose deployment:

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --since=15m redis api
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
```

Healthy Redis prints `PONG`. A failed command, Redis connection errors, publish
failures, or API readiness failures confirm that traffic must remain blocked.

After users have preserved available work:

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml stop --timeout 60 api
docker compose -f docker-compose.prod.yml ps --all api
```

Stopping the API disconnects clients. `ps api` must show it stopped before
Redis recovery begins.

## 2. Recover Redis

Restore or replace Redis using the platform's approved procedure. Do not restore
documents from Redis: PostgreSQL is authoritative. Verify Redis independently
and confirm that the configured `REDIS_KEY_PREFIX` is the intended environment.

For a running bundled Redis container:

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
```

Do not restart the API until this prints `PONG`.

## 3. Restart the entire API fleet

For the bundled single-replica deployment:

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml up -d --no-deps api
docker compose -f docker-compose.prod.yml ps api
```

For a multi-replica platform, perform a coordinated restart of every replica,
not a rolling partial restart. Each replica must cold-start against healthy
Redis and return HTTP 200 from its internal `/ready` check.

Working directory: any directory.

```bash
curl -fsS "https://app.example.com/ready"
```

Replace the hostname before running. Keep traffic blocked until this succeeds
and two clients pinned to different replicas can exchange and save a smoke edit.

## 4. Reconcile and escalate

- A `yjs:ack` means that update committed to PostgreSQL.
- Redis has no replay for lost awareness or chat, and reconnecting does not
  prove every unacknowledged edit was persisted.
- If clients show different text, preserve client copies and follow
  [Document divergence](incident-document-divergence.md).
- If a user reports lost unacknowledged work, escalate to the data owner; do not
  claim that restarting, Redis recovery, or an automated repair can recreate
  process-only state.

For the underlying behavior, see the
[dependency-failure model](../explanation/scaling-and-failure-model.md#dependency-failures).
