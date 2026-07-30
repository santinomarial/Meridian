# Server commands

Run commands from `server/`.

| Command | Executed program | Scope |
|---|---|---|
| `npm run build` | `nest build` | Compile to `dist/` |
| `npm start` | `nest start` | Start Nest without file watching |
| `npm run start:dev` | `nest start --watch` | Start Nest in watch mode |
| `npm run start:prod` | `node dist/main.js` | Start a previously built server |
| `npm test` | `jest` | Colocated Jest unit tests under `src/` |
| `npm run test:integration` | Jest integration config, `--runInBand` | Real-app tests under `test/` |
| `npm run load:realtime` | `node scripts/load-realtime.cjs` | Authenticated realtime load harness |
| `npm run db:generate` | `prisma generate` | Generate Prisma Client |
| `npm run db:migrate` | `prisma migrate dev` | Local migration development |
| `npm run db:studio` | `prisma studio` | Prisma browser UI |
| `npm run db:seed` | `prisma db seed` | Run `prisma/seed.ts` |
| `npm run infra:up` | `docker compose up -d` | Start local PostgreSQL and Redis |
| `npm run infra:down` | `docker compose down` | Stop local services; keep named volumes |

`npm install`/`npm ci` also runs
`scripts/fix-node-pty-helper.cjs` as `postinstall`.

Deployment uses `npx prisma migrate deploy`, not the `db:migrate` development
script. See [containers and Compose](../operations/containers-and-compose.md)
and [CI jobs](../ci-jobs.md).
