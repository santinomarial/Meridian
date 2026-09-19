# Release review — 2026-09-19

Application revision: `67d47d7`, following the production-readiness work recorded
in [the September 18 report](production-readiness-2026-09-18.md). This review
uses disposable local databases, browsers, and a loopback-only production
Compose stack. No public deployment was performed.

## Corrections

- Password recovery no longer claims success when a request fails. Both login
  and Settings allow retry; Settings prevents duplicate pending requests and
  distinguishes a local preview link from an email request (`80ccc6b`).
- Settings, version history, and the command palette keep keyboard focus within
  the active modal. Settings remains scrollable on short screens, version
  history stacks its list above the preview on narrow screens, and the command
  palette has an explicit close button (`caa228f`).
- Sign-out reports success only after server confirmation or an already-invalid
  session. Network/server errors preserve the workspace and let the user retry,
  instead of hiding a still-valid session (`c4adcee`).
- Copy Path preserves the actual workspace-relative folder hierarchy. Icon
  components now honor accessibility attributes and hide decorative glyph names
  from control labels (`67d47d7`).

Regression checks reproduced the recovery, focus/layout, and nested-path
failures before their fixes. Sign-out checks cover both entry points, including
server session validity after failure and successful retry. Visual inspection
covered the white default, black dark mode, mobile version preview, and Settings
in a 390-pixel-high viewport. Harvard crimson accents, recognizable language
icons, and VS Code-style syntax highlighting remain intact.

## Verification

| Check | Result |
|---|---|
| Client lint and production build | Passed; existing Monaco bundle-size warning remains |
| Server production build | Passed |
| Unit tests | 51 client and 446 server passed |
| PostgreSQL/Redis integration tests | 56 passed across 13 suites |
| Complete Chromium suite | 123 passed in 3.0 minutes on the clean-server run; no retries or skips |
| Targeted invite/export recheck | All four export scenarios passed three consecutive runs (12 passes) |
| Production dependency audits | Client and server: no reported vulnerabilities |
| Built production HTTPS browser smoke | Passed: CSP, secure session cookie, blocked endpoints, login, edit, save, versions, restore, reload, ZIP export |
| Container runtime smoke | Passed: non-root API, native PTY, Prisma runtime/CLI, nginx and cache/security headers |
| Production Compose startup | All nine migrations applied; API, PostgreSQL, and Redis healthy |
| Container restart recovery | HTTPS readiness recovered with PostgreSQL and Redis healthy |
| Local logical backup/restore | Restored one test user, one workspace, and all nine migration records into a separate database |
| Rebuilt image scans | API, web, migration, Caddy, PostgreSQL, Redis: no reported HIGH/CRITICAL findings |

The first complete browser run passed 122 tests and timed out on one invite-page
load during the viewer-export scenario, while container builds/scans were also
running. After restarting the development preview, all export scenarios passed
three repeated runs with tracing, followed by the clean 123-test full run. The
timeout's root cause was not established; no product change or relaxed assertion
was used to hide it.

Trivy 0.74.0 used its September 19 vulnerability database. Monitoring images
were not rescanned in this pass; their earlier dated results and scoped
exceptions remain in the September 18 report. Local HTTPS used Caddy's internal
certificate authority; public certificate issuance was not exercised.

## Public launch requirements

These local results establish a release candidate, not a running public service.
Before admitting production users:

1. Choose the host and domain, configure DNS, and verify public TLS and firewall
   behavior. Keep databases, API, and monitoring endpoints private.
2. Configure a verified sender and real Resend credential; test delivered signup
   verification, invitations, and password recovery. The local production smoke
   used a directly provisioned verified test account and did not send email.
3. Configure and exercise paging and encrypted off-host backups. This review
   proved a local logical restore, not remote backup delivery or host recovery.
4. Decide whether the integrated terminal is required at launch. It remains
   enabled for local development and prohibited in production until an isolated
   execution service and resource limits are implemented.

No public-load capacity, availability commitment, complete accessibility audit,
or penetration-test certification is implied. The Monaco bundle-size warning
remains; correctness checks pass independently of that performance warning.
See [known limitations](../known-limitations.md) and the
[deployment procedure](../../how-to/deploy-with-docker-compose.md).
