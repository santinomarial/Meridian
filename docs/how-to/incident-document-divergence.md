# Respond to document divergence

Use this runbook when replicas or clients show different live text, or when the
editor disagrees with checkpoint/export/terminal content.

## 1. Contain and preserve

1. Declare an incident and page the application and data owners.
2. Block collaborative writes and new Socket.IO sessions at the load balancer.
3. Record the document ID, affected users, replicas, timestamps, recent restore
   activity, Redis errors, and persistence-fencing metrics.
4. Ask each affected user to copy visible unsaved text to a local file. Do not
   force a Save from competing clients.
5. Select one healthy replica for controlled maintenance, or gracefully stop
   the entire fleet.

For the bundled Compose deployment, after client text is preserved:

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml stop --timeout 60 api
docker compose -f docker-compose.prod.yml ps --all api
```

Stopping disconnects clients. `ps api` must show the API stopped. In a
multi-replica platform, verify that every replica is drained; a partial stop can
continue the divergence.

## 2. Establish the durable state

Before any repair, create a [PostgreSQL backup](backup-and-restore-database.md).
Using read-only database access, have the data owner inspect:

- `Document.crdtGeneration` and `Document.content`;
- the latest `Snapshot` for the current generation;
- ordered `DocumentUpdate` rows after that snapshot; and
- recent `DocumentVersion` rows.

Correlate them with API logs for Redis publish errors, persistence failures, and
fenced writes. Do not update `Document.content`, delete CRDT rows, rewrite Redis
keys, or run an unreviewed SQL repair. The repository has no general automatic
divergence-repair command.

## 3. Choose a recovery path

If PostgreSQL's current CRDT lineage is coherent, restore Redis health and
restart every API replica so all processes cold-load that lineage.

For the bundled single-replica deployment:

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
docker compose -f docker-compose.prod.yml up -d --no-deps api
docker compose -f docker-compose.prod.yml ps api
```

Redis must print `PONG`, and the API must become healthy.

If the lineage is not acceptable, the data owner must choose a known-good
`DocumentVersion` or a preserved client copy. In a single-replica maintenance
window, use Meridian's normal version-restore flow for a known-good version; it
bumps the generation and replaces CRDT history. There is no repository
automation for merging arbitrary divergent client states. If the source is only
a client copy, preserve it as evidence and use an approved, reviewed recovery
procedure.

After a version restore, restart the entire API fleet again before admitting
traffic.

## 4. Verify and reopen

Working directory: any directory.

```bash
curl -fsS "https://app.example.com/ready"
```

Replace the hostname before running. Require HTTP 200 from every replica's
internal `/ready`, then verify:

1. Two clients pinned to different replicas load identical text.
2. A smoke edit fans out in both directions and receives `yjs:ack`.
3. Save/checkpoint succeeds, and a reconnect loads the saved result.
4. Export and a newly materialized terminal agree with the checkpoint when
   those features are in scope.

Reopen traffic only with data-owner approval. Keep client copies and the
pre-repair backup until the incident review is complete.

For the underlying behavior, see
[Persistence, compaction, and restore](../explanation/persistence-compaction-and-restore.md).
