# Contributing to Meridian

## Set up the project

Complete the [getting-started tutorial](docs/tutorials/getting-started.md) before
changing code. It verifies Node.js, both package installs, local infrastructure,
migrations, seed behavior, and the browser-to-database save path.

There is no root package manifest. Install dependencies and run commands inside
`client/` or `server/`.

## Branches and pull requests

Work on a focused branch rather than directly on `main`. This repository does
not prescribe a branch-naming convention.

Keep each pull request scoped to one coherent change. In its description:

- explain the problem and the chosen behavior;
- identify user-visible, API, schema, configuration, or operational effects;
- list the checks you ran and any checks you could not run;
- include or update tests for changed behavior; and
- update the appropriate tutorial, how-to, reference, or explanation document
  when the change affects users or operators.

Avoid mixing unrelated cleanup into a functional change. Review the diff for
secrets, generated output, local `.env` files, and accidental test artifacts
before opening the pull request.

## Package checks

### Client

Run from `client/`:

```bash
npm run lint
npm test
npm run build
```

`npm run build` performs the TypeScript project build before Vite creates the
production bundle. `npm run test:watch` is available while developing.

### Server

Run from `server/`:

```bash
npm run db:generate
npm run build
npm test
```

The server currently has no `lint` script. Do not report a server lint command
as having run; use its strict TypeScript build and Jest tests.

Server integration tests require a disposable migrated PostgreSQL database and
use Redis for realtime coverage:

```bash
npm run infra:up
npm run db:migrate
npm run test:integration
```

The integration suite uses the real NestJS application and may alter its
configured database even though it cleans up its synthetic records.

## End-to-end tests

Follow [Run browser end-to-end tests](docs/how-to/run-e2e-tests.md). The
procedure requires an isolated non-production server and disposable database.
Backend-dependent tests can skip when the API is unavailable, so do not report
a partially skipped run as full-stack coverage.

## Code conventions

- Preserve the strict TypeScript settings in both packages. The server also
  enables `noImplicitAny`, `noUncheckedIndexedAccess`, and strict null checks;
  the client rejects unused locals and parameters.
- Follow the style of the package and file you are changing. No repository-wide
  formatter configuration is committed.
- Keep browser code in `client/src/`, server code in `server/src/`, Prisma
  changes in `server/prisma/`, and browser scenarios in `client/e2e/`.
- Keep client unit tests next to source as `*.test.ts` (the current Vitest
  include does not select `*.test.tsx`), server unit tests as `*.spec.ts`,
  server integration tests in `server/test/` as `*.e2e-spec.ts`, and
  Playwright tests as `client/e2e/*.spec.ts`.
- After changing `server/prisma/schema.prisma`, create the appropriate migration
  and run `npm run db:generate`.
- Keep documentation in the correct
  [Diátaxis category](docs/README.md): tutorials, how-to guides, reference, or
  explanation.

See [Security](SECURITY.md) for vulnerability reports. Do not put undisclosed
security details in a public issue or pull request.
