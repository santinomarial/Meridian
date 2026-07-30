# Meridian server

The NestJS API and Socket.IO service for authentication, workspaces, durable
Yjs collaboration, PostgreSQL persistence, and optional Redis coordination.

For a complete first run, follow the
[getting-started tutorial](../docs/tutorials/getting-started.md).

## Run locally

After creating `server/.env`, starting the data services, and applying
migrations as described in the tutorial:

```bash
cd server
npm run start:dev
```

The default server listens on `http://localhost:3000`:

- `/health` checks process liveness.
- `/ready` checks dependency readiness.
- `/docs` and `/docs-json` expose generated OpenAPI documentation outside
  production only.

## Commands

Run all commands from `server/`:

- `npm start` / `npm run start:dev` — start Nest once / in watch mode.
- `npm run build` / `npm run start:prod` — compile to `dist/` / run the
  compiled server.
- `npm test` — run Jest unit tests.
- `npm run test:integration` — run serial integration tests against the real
  application and a disposable migrated database.
- `npm run db:generate` — generate Prisma Client.
- `npm run db:migrate` — run `prisma migrate dev` for local development.
- `npm run db:studio` / `npm run db:seed` — inspect / seed the database.
- `npm run infra:up` / `npm run infra:down` — start / stop local PostgreSQL and
  Redis while retaining named volumes.
- `npm run load:realtime` — run the manual realtime load harness.

There is currently no server lint script. Use the build and test commands for
the package checks documented in [Contributing](../CONTRIBUTING.md).

## Learn more

- [Server commands](../docs/reference/server/commands.md)
- [Server configuration](../docs/reference/server/configuration.md)
- [HTTP API](../docs/reference/server/http-api.md)
- [Server logging](../docs/reference/server/logging.md)
- [Server architecture](../docs/explanation/server-architecture.md)
- [Scaling and failure model](../docs/explanation/scaling-and-failure-model.md)
- [Deploy with Docker Compose](../docs/how-to/deploy-with-docker-compose.md)
- [Security boundaries](../SECURITY.md)
- [Documentation map](../docs/README.md)
