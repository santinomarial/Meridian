# Runbook: document divergence

## Symptoms

- Two replicas show different live text for the same `documentId`.
- Clients fight after reconnect, or `document:restored` storms.
- Export / checkpoint / terminal materialization disagree with the editor.
- Metrics: rising `meridian_persistence_fenced_total` or Redis publish errors
  during an incident.

## Likely causes

1. Redis fan-out gap while both replicas accepted local sticky edits.
2. Missed restore-control message (generation audit should eventually heal
   in-memory lineage; durable writes for the old generation stay fenced).
3. Partial fleet restart after a Postgres restore or Redis replacement.
4. Operators writing `Document.content` out of band (unsupported; use
   checkpoint / restore APIs).

## Immediate actions

1. Quiesce collaborative writes (LB drain or `REDIS_REQUIRED` readiness fail).
2. Pick a **single** healthy replica for maintenance, or stop all API processes.
3. Have users with unsaved work copy text locally; then checkpoint from one
   authoritative client if the CRDT lineage is still coherent.

## Repair

1. Confirm PostgreSQL `Document.crdtGeneration`, latest `Snapshot`, and
   `DocumentUpdate` rows for the document.
2. Restart the full API fleet so every process cold-loads from PostgreSQL.
3. If lineages are irreconcilable, restore from a known-good
   `DocumentVersion` via the restore API (bumps generation and replaces CRDT
   history), then restart the fleet again.
4. Re-admit traffic only after `/ready` is healthy on all replicas and a smoke
   edit fans out across two pinned sockets (see multi-replica integration
   tests for the expected shape).

## Prevention

- Always set `REDIS_REQUIRED=true` and a unique `REDIS_KEY_PREFIX` for
  multi-replica.
- Never restore Postgres or replace Redis without a coordinated API restart.
- Prefer sticky sessions; treat Redis outages as collaborative outages.
