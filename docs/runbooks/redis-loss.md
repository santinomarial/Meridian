# Runbook: Redis loss

## Symptoms

- `GET /ready` returns 503 when `REDIS_REQUIRED=true` and Redis is down or
  unpingable.
- Logs: `Redis publish failed`, `Redis client connection closed`, or startup
  `Redis unavailable`.
- Collaborators on different replicas stop seeing each other's live edits,
  awareness, chat, or sandbox sync; sticky same-replica peers may still work.
- Durable `yjs:ack` / PostgreSQL writes can continue; Redis is not the
  durability boundary.

## Immediate actions

1. Stop admitting new collaborative traffic at the load balancer (remove
   backends that are not_ready, or fail closed on `/ready`).
2. Quiesce writes: ask users to checkpoint (`POST /documents/:id/checkpoint`)
   if they still have a working sticky session.
3. Do **not** leave a mixed fleet where some replicas have Redis and others do
   not.

## Recovery

1. Restore Redis independently; verify `PING` and that the intended
   `REDIS_KEY_PREFIX` namespace is empty or expected.
2. Restart **every** API replica so pattern subscriptions and seq seed flags
   reinitialize against a healthy Redis.
3. Confirm `/ready` returns 200 with `dependencies.redis: ok` on each replica.
4. Re-admit traffic; clients reconnect and rejoin rooms.

## Notes

- Updates that were acked (`yjs:ack`) are in PostgreSQL and survive.
- Updates accepted into memory but never persisted are not recoverable from
  Redis replay; there is none. Prefer client outbound-queue resend after
  reconnect.
- Full detail: [scaling.md - Redis failure behavior](../scaling.md#redis-failure-behavior).
