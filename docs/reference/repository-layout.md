# Repository layout

Meridian is a two-package repository. There is no root `package.json`; install,
run, and test the client and server from their own directories.

```text
Meridian/
|-- .github/workflows/ci.yml       GitHub Actions workflow
|-- client/                        React/Vite browser application
|   |-- e2e/                       Playwright specs, helpers, and fixtures
|   |-- public/                    Static assets copied by Vite
|   |-- src/                       Client source and colocated unit tests
|   |-- Dockerfile                 Build + non-root Nginx runtime
|   |-- nginx.conf                 SPA fallback, CSP, cache/security headers
|   |-- package.json               Client commands and dependencies
|   |-- playwright.config.ts       Browser-test configuration
|   |-- vite.config.ts             Vite configuration
|   `-- vitest.config.ts           Unit-test configuration
|-- deploy/Caddyfile               Public TLS edge and reverse proxy
|-- deploy/monitoring/             Prometheus rules and Alertmanager routing
|-- deploy/systemd/                Fail-closed scheduled backup units and environment template
|-- docs/
|   |-- explanation/               Concept and architecture documents
|   |-- how-to/                    Task-oriented and incident procedures
|   |-- reference/                 Code/config-derived reference
|   `-- tutorials/                 Learning-oriented walkthroughs
|-- scripts/                       Container smoke and production backup/upload helpers
|-- server/                        NestJS API and Socket.IO application
|   |-- prisma/                    Schema, migrations, and seed
|   |-- scripts/                   Load, backup, and install helpers
|   |-- src/
|   |   |-- common/                Guards, filters, metrics, validation, retention
|   |   |-- config/                Environment validation and typed AppConfig
|   |   |-- documents/             Document/tree/version HTTP domain
|   |   |-- e2e/                   Test-only controller and safety guards
|   |   |-- invites/               Invite HTTP domain
|   |   |-- modules/
|   |   |   |-- auth/              Sessions, JWT, password reset
|   |   |   |-- mail/              Resend integration
|   |   |   |-- realtime/          Editor gateway, Yjs state/persistence
|   |   |   |-- realtime-authorization/  Socket invalidation/rechecks
|   |   |   `-- terminal/          PTY gateway and filesystem projection
|   |   |-- prisma/                Prisma service/module
|   |   |-- redis/                 Redis service/module
|   |   |-- users/                 User HTTP domain
|   |   |-- workspaces/            Workspace/membership HTTP domain
|   |   `-- app.*, main.ts         Composition, HTTP setup, bootstrap
|   |-- test/                      Real-app integration tests
|   |-- Dockerfile                 API and migration image targets
|   |-- docker-compose.yml         Local PostgreSQL and Redis
|   `-- package.json               Server commands and dependencies
|-- .env.production.example       Production Compose variable template
`-- docker-compose.prod.yml        Production single-API Compose stack
```

## Reference index

- [CI jobs](ci-jobs.md)
- [Client commands](client/commands.md), [configuration](client/configuration.md),
  [source layout](client/source-layout.md), and [CSP](client/csp.md)
- [Server commands](server/commands.md),
  [configuration](server/configuration.md), [HTTP API](server/http-api.md),
  [Socket.IO events](server/socket-events.md),
  [logging](server/logging.md), [limits](server/rate-limits-and-body-limits.md),
  and
  [health/metrics](server/health-and-metrics.md)
- [Containers and Compose](operations/containers-and-compose.md)

For system design and operational rationale, see the
[system overview](../explanation/system-overview.md),
[trust boundaries](../explanation/trust-boundaries.md), and
[scaling/failure model](../explanation/scaling-and-failure-model.md).
