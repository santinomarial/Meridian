# Pre-deployment verification — 2026-09-18

This records the repository and local deployment checks performed before public
deployment. The supported release topology is one API replica behind Caddy,
with PostgreSQL, Redis, the static client, and the terminal disabled. No public
deployment was performed. Live infrastructure checks below remain necessary
before admitting production users.

## Correctness fixes

- Browser outbox entries carry their original CRDT generation. Restores cannot
  accidentally accept old edits after the browser rejoins. Unknown/obsolete
  generations are archived in IndexedDB and downloadable through **Export
  Recovery Data**. This exports original CRDT bytes, not guaranteed standalone
  plain text; reconstruction can require the original document history.
- Pending updates are replayed after the initial Monaco binding, reapplied
  locally after reload, and retried while connected if delivery or an ack was
  lost. Editing waits for initial synchronization, with visible loading state.
- Save no longer overwrites a live editor with an older checkpoint response.
  Concurrent edits remain visible and dirty when they differ from the checkpoint.
- Redis sequence allocation is floored against PostgreSQL every time. Missing
  pub/sub updates can recover through compacted snapshots, and a periodic audit
  repairs a lost final notification even if nobody makes another edit.
- Cold document initialization and import/restore generation changes serialize
  under the document lock. Snapshot-plus-delta reads use a consistent database
  view. Shutdown drains persistence before disconnecting Prisma.
- Browser WebSocket Origin validation now applies to the initial upgrade,
  independently of HTTP CORS and in addition to session authorization.
- Terminal input stays ordered across asynchronous permission checks and cannot
  spill into a replacement terminal session. This addresses a real failure
  reproduced by the browser suite; production continues to reject terminal use.
- Public `/metrics`, `/docs`, and `/e2e` requests terminate at the edge before
  SPA fallback. Caddy and nginx no longer retain bearer URLs in ordinary request
  logs. Production password generation uses URL-safe hex.
- Caddy, PostgreSQL, and Redis images are hardened and included in CI scans.
  Infrastructure smoke checks cover startup, migrations, restart, TLS routing,
  private endpoints, and log redaction. E2E setup fails when an explicitly
  configured backend or its required test cleanup endpoint is unavailable.

## Verification evidence

| Check | Result |
|---|---|
| Client lint, TypeScript/Vite production build | Passed |
| Client unit tests | 51 passed |
| Server build and unit tests | 446 passed; repeated on Linux / Node 22 |
| Real PostgreSQL/Redis integration tests | 56 passed across 13 suites, including multiple API replicas; repeated on Linux / Node 22 |
| Chromium browser suite | 104 passed, no retries or skips, in 2.6 minutes on macOS |
| Production HTTPS browser smoke | Passed against built client/API and the hardened Compose stack |
| Container runtime smoke | Passed: non-root API, native PTY module, Prisma engine/CLI, nginx config and security/cache headers |
| Infrastructure smoke | Passed: new PostgreSQL volume, migrations, restart, Caddy TLS, blocked routes, token-safe edge/web logs |
| PostgreSQL logical backup/restore | Passed; sentinel and all 9 migration records verified, including restore into the new Alpine image |
| Automated Compose backup | Dump/checksum/status files passed; missing mandatory offsite hook fails closed |
| Monitoring configuration | Prometheus and Alertmanager native validation passed |
| Shell scripts | Syntax and ShellCheck passed |
| npm production dependency audits | No reported vulnerabilities for client or server |
| Final API, migration, web, Caddy, PostgreSQL, Redis image scans | No reported HIGH/CRITICAL findings |
| Monitoring image scans | Passed under the existing scoped exception files; exceptions expire 2026-10-10 |

The production browser smoke checked HTTPS routing, CSP, Secure/HttpOnly/Lax
session cookies, login with a verified account, file creation, collaborative
editing, Save, version creation, restore, refresh persistence, ZIP export, and
absence of browser JavaScript errors. It used a disposable local account and
localhost's internal certificate authority. Public certificate issuance and
real email delivery were not exercised.

The local collaboration load probe ran 10, 25, and 50 concurrent users with five
updates each: **425/425 durable acknowledgements**, no failed users, and 100%
expected peer deliveries. At 50 users, ack latency was p95 **223.40 ms**, p99
**244.07 ms**, with **262.7 updates/second** during the short burst. This used
loopback networking and the test configuration's relaxed throttling; it is a
regression probe, not a production capacity or sustained-latency guarantee.

Image scans used Trivy 0.74.0 and the vulnerability database available on the
verification date. They do not replace application review or future scanning.
The existing monitoring exceptions are in
[`trivyignore-prometheus.yaml`](../../../deploy/monitoring/trivyignore-prometheus.yaml)
and [`trivyignore-alertmanager.yaml`](../../../deploy/monitoring/trivyignore-alertmanager.yaml).

## Release and live-service requirements

1. Deploy the client and API together and reload existing tabs. The new Yjs
   message contract requires `generation`; old pending entries are archived
   conservatively. See [socket events](../server/socket-events.md).
2. For an existing Debian PostgreSQL volume, stop writers, make a logical dump,
   and restore into a new Alpine volume. Verify data and retain the original
   volume for rollback. Fresh deployments need no conversion.
3. Provision actual production secrets, DNS/firewall rules, and public TLS.
   Test registration, delivered verification mail, password reset, and one-time
   token use against the verified sending domain.
4. Configure the paging receiver and encrypted off-host backup repository.
   Verify a delivered alert and a restore from the actual remote backup. The
   local offsite-hook smoke used a successful stub; it did not prove an upload.
5. Reboot the target host and repeat health/readiness and browser smoke checks.
   Keep API, PostgreSQL, Redis, nginx, and monitoring ports private. Measure
   resource limits and capacity on that host before raising concurrency.

Commands and live-service details are in
[Deploy with Docker Compose](../../how-to/deploy-with-docker-compose.md),
[Backup and restore](../../how-to/backup-and-restore-database.md), and
[Containers and Compose](containers-and-compose.md).

Repeatable local checks added in this pass:

```bash
bash scripts/smoke-infrastructure.sh
# Requires images built with the meridian-{caddy,postgres,web,migrate}:ci tags.

SMOKE_BASE_URL=https://localhost:18443 \
SMOKE_EMAIL=smoke@example.com SMOKE_PASSWORD='disposable-password' \
SMOKE_IGNORE_HTTPS_ERRORS=true node scripts/smoke-production.cjs
# Certificate bypass is permitted only for loopback targets.
```
