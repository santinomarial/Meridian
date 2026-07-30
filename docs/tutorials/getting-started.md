# Get Meridian running locally

In this tutorial you will start Meridian, sign in to its seeded workspace, edit
the seeded `README.md`, and save a durable checkpoint.

## Before you start

Install:

- Node.js 22.22 or later with npm
- Docker with Docker Compose v2
- OpenSSL, used here to generate a development signing secret

The server installs `node-pty`, a native dependency. Prebuilt binaries may be
available for your platform. If `npm ci` reports a `node-gyp` or compiler
failure, install Python 3, `make`, and a C/C++ toolchain (Xcode Command Line
Tools on macOS or the distribution build tools on Linux), then rerun it.

Use three terminals from the repository root. Ports `3000`, `5173`, `5432`, and
`6379` must be available.

## 1. Install and configure the server

In the first terminal:

```bash
cd server
npm ci
test ! -e .env && cp .env.example .env
```

The final command exits without output when it creates the file. If it fails
because `server/.env` already exists, preserve and review that file instead of
overwriting it.

Open `server/.env` and replace `change-me-in-production` with the output of:

```bash
openssl rand -hex 32
```

The result is a 64-character value. Keep `PORT=3000`,
`CLIENT_ORIGIN=http://localhost:5173`, and the local database and Redis URLs
unchanged for this tutorial.

## 2. Start the data services

Still in `server/`:

```bash
npm run infra:up
docker compose exec postgres pg_isready -U postgres
docker compose exec redis redis-cli ping
```

Do not continue until PostgreSQL reports `accepting connections` and Redis
prints:

```text
PONG
```

If either check fails immediately after startup, wait a few seconds and run
both checks again. The development Compose file has no health checks.

## 3. Create and seed the database

Run:

```bash
npm run db:migrate
npm run db:seed
```

The migration command should finish without an error after applying the
committed Prisma migrations. The seed output ends with values in this shape:

```text
Seeding…
  users: alice@meridian.dev, bob@meridian.dev, carol@meridian.dev, dave@meridian.dev
  login password: Meridian1!
  workspace: Meridian (<generated workspace ID>)
  members: 4
  documents: 16
  snapshots: 3
Done.
```

The seed is repeatable, but it is not harmless: rerunning it resets the demo
users' passwords, rewrites seeded document contents, and replaces seeded CRDT
history. Use it only with disposable development data.

## 4. Start the API

Run this command and leave it running:

```bash
npm run start:dev
```

In the second terminal, verify the process:

```bash
curl --fail http://localhost:3000/health
curl --fail http://localhost:3000/ready
```

Both commands should return JSON and exit successfully. `/ready` should report
PostgreSQL as ready. It also reports Redis state; Redis is not an HTTP readiness
requirement in this single-process configuration.

If startup reports environment validation errors, check `DATABASE_URL` and
confirm that `JWT_SECRET` is at least 16 characters.

## 5. Start the web client

In the third terminal, from the repository root:

```bash
cd client
npm ci
npm run dev
```

Vite should print a local URL at `http://localhost:5173/`. Keep this process
running.

## 6. Sign in to the seed workspace

Open [http://localhost:5173](http://localhost:5173). The page should show the
**Log in** form.

Enter:

- Email Address: `alice@meridian.dev`
- Password: `Meridian1!`

Select **Log in**. Meridian should open the **Meridian** workspace with the file
explorer visible and the seeded `README.md` selected. Alice is the workspace
owner, so editing is enabled.

If the page says the backend is unavailable, confirm that the API health check
still succeeds and that the browser URL uses port `5173`.

## 7. Edit and save a file

In the editor:

1. Add a line to `README.md`.
2. Confirm that the status bar changes from **Saved** to **Unsaved**.
3. Press <kbd>Cmd</kbd>+<kbd>S</kbd> on macOS or
   <kbd>Ctrl</kbd>+<kbd>S</kbd> on Linux and Windows.
4. Confirm that the status bar briefly shows **Saving…** and then **Saved**.
5. Reload the page, reopen `README.md` if necessary, and confirm that the new
   line remains.

You have now made a collaborative edit and checkpointed it to the saved
document state used by versions, exports, and terminal materialization.

## Stop the tutorial environment

Stop the API and Vite processes with <kbd>Ctrl</kbd>+<kbd>C</kbd>. Then, from
`server/`, stop PostgreSQL and Redis:

```bash
npm run infra:down
```

This keeps the named Docker volumes, so the database remains available the next
time you start the services.
