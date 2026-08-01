# Known limitations

This page is the canonical inventory of architectural limits. The linked
explanation documents own the rationale so it is not repeated here.

1. **Redis Pub/Sub is not a durable event log.** Redis reconnects and restores
   subscriptions, and its availability changes on connection close/ready, but
   messages emitted during an outage are not replayed. Committed Yjs sequence
   gaps can catch up from PostgreSQL; awareness, chat, authorization fast-path
   invalidations, and terminal projection operations cannot. See
   [Scaling and failure model](../explanation/scaling-and-failure-model.md).

2. **Realtime visibility can precede durability.** Local peers receive a Yjs
   update before its PostgreSQL transaction commits. The sender receives a
   durable `yjs:ack` only after commit and keeps an idempotent IndexedDB outbox;
   a failed persist does not roll back the already-applied in-memory update. See
   [Realtime collaboration](../explanation/realtime-collaboration.md).

3. **Saved consumers can lag collaborative text.** `Document.content` changes
   only on create, import, checkpoint, or restore. Export, versions, ordinary
   REST reads, and new terminal projections omit durable-but-uncheckpointed
   edits. See
   [Document model and save](../explanation/document-model-and-save.md).

4. **Multi-replica state is only partly shared.** Socket rooms, loaded Yjs
   documents, authorization caches, throttles, and PTYs are process-local.
   Socket.IO requires session affinity, and process-local rate budgets multiply
   with replicas. See
   [Scaling and failure model](../explanation/scaling-and-failure-model.md).

5. **The terminal is host command execution.** Its temporary directory,
   reduced environment, path checks, and cleanup are not operating-system
   isolation. There are no global PTY, CPU, memory, process, network, or disk
   quotas. Production validation prohibits enabling it, and abrupt failure can
   leave temporary files. See
   [Terminal execution](../explanation/terminal-execution.md).

6. **HTTP body parsing precedes Nest authorization and throttling.** Built-in
   throttles are process-local, so authoritative request-size, connection, and
   abuse controls belong at the ingress. `TRUST_PROXY` is configurable and must
   match the actual proxy chain. See
   [Server architecture](../explanation/server-architecture.md) and
   [Trust boundaries](../explanation/trust-boundaries.md).

7. **Workspace export is in-memory.** Source document count, source bytes, and
   final archive size are bounded, but ZIP construction is not streamed. See
   [Document model and save](../explanation/document-model-and-save.md).

8. **Invite URLs remain bearer credentials.** Tokens are hashed at rest and
   conditionally claimed in the same transaction as membership creation, so
   exactly one concurrent redemption can succeed. Email-bound acceptance also
   requires a verified matching account. The raw token must still appear in
   the creation response, URL, and optional mail, so those surfaces remain
   sensitive. See
   [Authorization and roles](../explanation/authorization-and-roles.md).

9. **The browser cookie model is same-site.** There is no separate CSRF token,
    and a genuinely cross-site frontend/API deployment requires code and policy
    changes, not only CORS configuration. See
    [Authentication and sessions](../explanation/authentication-and-sessions.md).

10. **Terminal projection is not replica-consistent storage.** Cross-replica
    projection operations have no durable replay, acknowledgement, or global
    ordering. Re-materialization from the saved PostgreSQL checkpoint is the
    repair boundary. See
    [Terminal execution](../explanation/terminal-execution.md).

11. **Operational cleanup is periodic and incomplete by design.** Expired or
    revoked sessions, used or expired verification/reset tokens, and accepted
    or expired invites are purged hourly. Application retention does not define
    retention for logs, backups, version history, or crash-left temporary files.

12. **Capacity evidence is narrow and historical.** The retained July 24, 2026
    numbers cover one local API process and were not reverified during this
    rewrite. They omit WAN, TLS, load balancers, multi-replica load, failure
    injection, and soak behavior. See
    [Performance baseline](../explanation/performance-baseline.md).

13. **Production API documentation is intentionally absent.** Swagger is
    mounted only outside production. Consumers need a separately generated or
    controlled reference artifact if production API discoverability is a
    requirement. See
    [Server architecture](../explanation/server-architecture.md).
