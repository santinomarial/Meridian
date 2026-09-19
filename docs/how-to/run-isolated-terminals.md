# Run isolated terminals

Meridian supports a separate terminal worker. The API sends saved text files and
folders to the worker over an authenticated private HTTP connection. The worker
starts one disposable sandbox for each browser terminal; the API never mounts
Docker's socket or workspace directories into user workloads. Settled text edits
return through the existing transactional import, version history, and conflict
recovery paths. Each browser gets a separate projection, including two browsers
belonging to the same user.

## Production requirements

Use a Linux host with Docker and **gVisor's `runsc` runtime** installed following
the [official installation guide](https://gvisor.dev/docs/user_guide/install/) and
[Docker integration guide](https://gvisor.dev/docs/user_guide/quick_start/docker/).
The worker checks Docker's configured runtimes and refuses to start without
`runsc`. It never automatically falls back to ordinary containers. Operators must
ensure the registered `runsc` binary is the genuine, maintained gVisor runtime.

The worker controls Docker and therefore has administrative access to its host.
Keep it on a private network, preferably on a dedicated execution host. Never
publish its port publicly or expose the Docker API. Across hosts use an encrypted
private network or a TLS reverse proxy; the bearer token is not transport
security. Each worker must have a unique namespace and only one active process
per namespace. The current API connection targets one worker; it does not balance
sandboxes across a pool.

The included overlay supports a single-host private Compose installation:

```sh
# First complete .env using .env.production.example, including a random RUNNER_TOKEN.
docker build -f runner/Dockerfile.sandbox -t meridian-sandbox:local runner
docker compose -f docker-compose.prod.yml -f docker-compose.terminal.yml up --build -d
```

Pin `RUNNER_IMAGE` to an audited immutable digest for a release. The worker resolves
the configured image to its immutable local ID on startup and never pulls images
while creating a session. Build and scan both worker and workload images before
release. Budget capacity for eight workloads at up to 1 GiB each, plus the API,
database, broker, and operating system. Tune capacity only after load testing.

For a worker on another host, configure the API directly:

```dotenv
ENABLE_TERMINAL=true
TERMINAL_BACKEND=isolated
TERMINAL_RUNNER_URL=https://PRIVATE_WORKER_ORIGIN
TERMINAL_RUNNER_TOKEN=SAME_RANDOM_SECRET_AS_WORKER_RUNNER_TOKEN
```

The API's `/ready` includes the worker when isolated execution is enabled. In
production it also rejects a worker reporting development-only isolation. The
host backend remains forbidden in production.

## Resource and access policy

Each workload runs as UID/GID 1000, without Linux capabilities or privilege
escalation, with a read-only image, no host mounts and no networking. CPU is
limited to one core, memory and swap together to 1 GiB, processes to 128,
workspace tmpfs to 128 MiB, and temporary files to 256 MiB. No API or worker secrets
are supplied to workloads. Node.js, Python, Bash, Go, and TypeScript (`tsx`) are
included. Outbound package installs and network-dependent programs are not
supported by this initial policy.

The worker allows eight sandboxes total and two per user. It expires workloads
after four hours, thirty minutes without terminal input, or ninety seconds
without API contact. Terminal output buffering and queued input are bounded;
excessive output stops the workload. Normal termination attempts a final text
import before removing the sandbox. The worker reaps its own labeled orphan
containers on restart. Never reuse one worker namespace for independent workers.

Files are exchanged as bounded JSON text, not host mounts or extracted archives.
The workload-side helper uses directory descriptors and `O_NOFOLLOW`, rejects
traversal, links and special files, and bounds traversal and output. The API
independently validates paths, counts and sizes. Editor writes use the previous
projected content as a precondition, preserving terminal edits for conflict
recovery. Imports retain the existing 1 MiB/file, 1,000-file, 25 MiB text limits.
Excluded build/dependency/binary files stay ephemeral. Shell deletes do not delete
saved editor documents. Editor rename/delete affects acknowledged text files;
excluded terminal-only files are preserved and empty old directories can remain.

This is not durable disk storage: abrupt worker/host failure, resource exhaustion,
or forced expiry can lose changes not yet imported. A temporary database failure
keeps the sandbox available for import retry, subject to the hard worker lifetime.
The terminal's saved state only acknowledges committed text imports.

## Local verification on Docker Desktop

Docker Desktop here has `runc`, not `runsc`. The worker supports an explicit
**development-only** mode to test transport, PTY, limits, file sync and cleanup:

```sh
npm ci --prefix runner
docker build -f runner/Dockerfile.sandbox -t meridian-sandbox:local runner
# Use a generated secret; supply the same value to the API and smoke test.
export RUNNER_TOKEN="$(openssl rand -hex 32)"
NODE_ENV=development RUNNER_ALLOW_UNSAFE_LOCAL=true PORT=4400 npm start --prefix runner
```

This mode always binds loopback. In another terminal with the same token:

```sh
RUNNER_URL=http://127.0.0.1:4400 npm run test:integration --prefix runner
```

Point a disposable development API at it with `TERMINAL_BACKEND=isolated` and
`TERMINAL_RUNNER_URL=http://127.0.0.1:4400`. These checks do **not** qualify gVisor or
the deployment host. Repeat smoke, browser, hostile-workload and recovery checks
on the actual Linux/gVisor host before enabling public execution.
