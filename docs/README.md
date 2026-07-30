# Meridian documentation

Choose a document by what you are trying to do. The sections follow
[Diátaxis](https://diataxis.fr/): tutorials teach, how-to guides solve a task,
reference describes the system, and explanation builds understanding.

## Tutorials

Learning-oriented, end-to-end lessons:

- [Get Meridian running locally](tutorials/getting-started.md) — start from a
  fresh checkout, sign in to the seed workspace, edit a file, and save it.

## How-to guides

Task-oriented procedures:

- [Deploy with Docker Compose](how-to/deploy-with-docker-compose.md)
- [Deploy the client to a static host](how-to/deploy-client-static-host.md)
- [Deploy multiple API replicas](how-to/deploy-multi-replica.md)
- [Configure email delivery](how-to/configure-email-delivery.md)
- [Run server tests](how-to/run-server-tests.md)
- [Run browser end-to-end tests](how-to/run-e2e-tests.md)
- [Run the realtime load test](how-to/run-load-test.md)
- [Run CI checks locally](how-to/run-ci-locally.md)
- [Back up and restore PostgreSQL](how-to/backup-and-restore-database.md)
- [Respond to Redis loss](how-to/incident-redis-loss.md)
- [Investigate document divergence](how-to/incident-document-divergence.md)

## Reference

Facts, commands, and package entry points:

- [Repository layout](reference/repository-layout.md)
- [CI jobs](reference/ci-jobs.md)
- [Known limitations](reference/known-limitations.md)
- [Containers and Compose](reference/operations/containers-and-compose.md)
- Client
  - [Commands](reference/client/commands.md)
  - [Configuration](reference/client/configuration.md)
  - [Source layout](reference/client/source-layout.md)
  - [Content Security Policy](reference/client/csp.md)
- Server
  - [Commands](reference/server/commands.md)
  - [Configuration](reference/server/configuration.md)
  - [HTTP API](reference/server/http-api.md)
  - [Socket.IO events](reference/server/socket-events.md)
  - [Health and metrics](reference/server/health-and-metrics.md)
  - [Logging](reference/server/logging.md)
  - [Rate limits and body limits](reference/server/rate-limits-and-body-limits.md)

## Explanation

Concept-oriented background and trade-offs:

- [System overview](explanation/system-overview.md)
- [Client architecture](explanation/client-architecture.md)
- [Server architecture](explanation/server-architecture.md)
- [Authentication and sessions](explanation/authentication-and-sessions.md)
- [Authorization and roles](explanation/authorization-and-roles.md)
- [Data model](explanation/data-model.md)
- [Document model and save](explanation/document-model-and-save.md)
- [Realtime collaboration](explanation/realtime-collaboration.md)
- [Persistence, compaction, and restore](explanation/persistence-compaction-and-restore.md)
- [Scaling and failure model](explanation/scaling-and-failure-model.md)
- [Performance baseline](explanation/performance-baseline.md)
- [Terminal execution](explanation/terminal-execution.md)
- [Trust boundaries](explanation/trust-boundaries.md)
