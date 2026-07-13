# Meridian Client

The Meridian client is a React and TypeScript single-page application for the
collaborative workspace. It provides authentication, workspace navigation,
Monaco-based editing, file operations, version history, invitations, presence,
chat, and the browser side of the optional integrated terminal.

The client communicates with the [Meridian server](../server/README.md) through
credentialed HTTP requests and Socket.IO. For repository-wide architecture and
setup information, see the [main README](../README.md).

## Technical overview

| Concern | Implementation |
|---|---|
| Application shell | React 18, React Router, and route-level lazy loading |
| Build system | TypeScript project references and Vite 8 |
| Styling | Tailwind CSS with shared component primitives |
| Workspace state | Zustand |
| Code editor | Monaco Editor with bundled language workers |
| Collaborative editing | Yjs, y-monaco, and the Yjs awareness protocol |
| Realtime transport | Socket.IO with credentialed WebSocket and polling transports |
| Terminal UI | xterm.js; PTY execution remains a server responsibility |
| Unit tests | Vitest in a Node environment |
| Browser tests | Playwright using Chromium |

Monaco and its editor, TypeScript, JSON, CSS, and HTML workers are built into
the application. The editor does not depend on a public CDN at runtime.

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`, as required by Vite 8
- npm
- A running Meridian server for authentication, persistence, collaboration,
  invitations, version history, export, and terminal features

The workspace falls back to a clearly identified local demonstration dataset
when backend workspace loading cannot complete because of a network or server
failure. An authentication `401` returns the user to sign-in instead. The
fallback is not persistent and does not replace the server for integration
testing.

## Local development

Install the locked dependency set and start the Vite development server:

```bash
cd client
npm ci
npm run dev
```

The application is available at `http://localhost:5173`. In development, REST
and Socket.IO connections default to `http://localhost:3000`. Follow the
[server documentation](../server/README.md) to run the complete application.

## Configuration

Runtime endpoint configuration is evaluated by Vite. Variables prefixed with
`VITE_` are embedded in browser assets and must never contain secrets.

| Variable | Development default | Production default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | Browser origin | REST API base URL |
| `VITE_SOCKET_URL` | `http://localhost:3000` | Browser origin | Socket.IO server URL |

For a non-default local server, create `client/.env.local`:

```dotenv
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
```

Restart the development server after changing these values. Any production
overrides must be present when `npm run build` runs because Vite replaces them
at build time.

The HTTP client sends cookies with every request, and the Socket.IO client also
enables credentials. In development, the server accepts browser origins only
from `localhost` and `127.0.0.1` on ports 5173 through 5175; changing
`CLIENT_ORIGIN` does not extend that allow-list. In test and production, the
browser origin must match `CLIENT_ORIGIN` exactly.

## Commands

Run these commands from `client/`.

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check the project and create a production bundle in `dist/` |
| `npm run preview` | Serve the current production bundle for local verification |
| `npm run lint` | Run ESLint over the client source |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run test:e2e` | Run the Playwright suite |
| `npm run test:e2e:ui` | Open Playwright's interactive test runner |
| `npm run test:e2e:headed` | Run Playwright with a visible browser |

The standard local verification sequence is:

```bash
npm run lint
npm test
npm run build
```

`npm run preview` serves only the generated static files; the Vite configuration
does not define an API or Socket.IO proxy. A full-stack preview therefore needs
API endpoints embedded at build time through `VITE_API_URL` and
`VITE_SOCKET_URL`, or an external same-origin reverse proxy.

## Document state and save semantics

Meridian maintains two representations of file content:

- `Document.content` is the explicitly saved plain-text value returned by the
  workspace REST API. It is also used for version creation, workspace export,
  and terminal materialization.
- A Yjs document is the live collaborative value after a file joins a realtime
  editing session. Its incremental updates are persisted asynchronously in the
  server's CRDT update log and snapshots.

Loading a workspace initially populates the client from `Document.content`.
Joining a document then synchronizes its Yjs state and binds Monaco to that
state. Editing updates Yjs immediately and marks the tab dirty; it does not
update `Document.content`. The Save command sends the editor's current value
through `PATCH /documents/:documentId`, which updates `Document.content` and
creates a version only when that saved value changes.

This boundary has several operational consequences:

- A collaborative edit can be present in the persisted Yjs history while still
  being absent from exports, versions, and newly materialized terminal files.
- Export or version operations that must include the latest editor value should
  be preceded by a successful Save.
- The generic REST content update and bulk-import paths do not reset an
  already-open Yjs document. The normal client Save flow is coherent because
  the same value is already present in the active Yjs document; out-of-band
  content writes or replacement imports must not target an actively edited
  document.

Version restore has a dedicated reconciliation path, with the deployment limits
described in [Architecture](../docs/architecture.md) and
[Horizontal scaling](../docs/scaling.md).

## End-to-end tests

Install the Playwright browser once after installing dependencies:

```bash
npx playwright install chromium
```

Playwright starts `npm run dev` automatically, waits for the configured client
URL, and reuses an existing development server. The suite runs serially in one
Chromium worker. Without a reachable backend, offline and request-stubbed tests
still run while backend-dependent groups skip themselves.

### Complete suite

The complete suite requires a migrated PostgreSQL database and a configured
server. Run Redis as well to exercise the standard realtime topology. Start the
server in its dedicated E2E mode with terminal support:

```bash
# From server/
E2E_TEST=true ENABLE_TERMINAL=true npm run start:dev
```

Then run Playwright from the client directory:

```bash
# From client/
MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e
```

`E2E_TEST=true` is a server-only setting. It raises test rate limits and enables
the scoped cleanup and password-reset helpers used by the suite. Server startup
rejects this setting when `NODE_ENV=production`. `ENABLE_TERMINAL=true` is
required for the terminal and command-palette scenarios in the complete suite.

When testing against non-default ports, keep `MERIDIAN_BACKEND_URL`,
`VITE_API_URL`, and `VITE_SOCKET_URL` aligned.

### Playwright configuration

| Variable | Default | Purpose |
|---|---|---|
| `MERIDIAN_BASE_URL` | `http://localhost:5173` | Browser base URL and Vite readiness URL |
| `MERIDIAN_BACKEND_URL` | `http://localhost:3000` | Backend probe and E2E helper base URL |
| `CI` | Unset | Reject focused tests and enable one retry when set |

The global setup creates the deterministic ZIP import fixture and attempts to
remove stale `e2e-` test accounts through the guarded server helper. Traces and
videos are retained on the first retry, and the HTML report never opens
automatically.

## Source layout

```text
client/
|-- e2e/                    Playwright specifications, fixtures, and helpers
|-- public/                 Static assets copied directly into the build
|-- src/
|   |-- components/editor/ Monaco editor integration
|   |-- components/layout/ Workspace shell, panels, dialogs, and menus
|   |-- components/ui/     Shared UI primitives
|   |-- data/              Local demonstration workspace data
|   |-- hooks/             Workspace, persistence, realtime, and terminal flows
|   |-- lib/               API, Socket.IO, Yjs, Monaco, and utility modules
|   |-- pages/             Route-level application pages
|   |-- store/             Zustand workspace state
|   `-- types/             Client domain types
|-- playwright.config.ts   Browser test configuration
|-- vite.config.ts         Production and development bundling
`-- vitest.config.ts       Unit test discovery and runtime
```

Unit tests use the `src/**/*.test.ts` convention. Playwright tests use
`e2e/*.spec.ts`, which keeps the two runners isolated.

## Production deployment

Create the static bundle with:

```bash
npm ci
npm run build
```

Deploy only the generated `dist/` directory. The static host must return
`index.html` for unknown application routes because the client uses
`BrowserRouter`; this includes workspace, session, invite, and password-reset
deep links.

The default production topology serves the client and server from one origin.
Route the server's HTTP endpoints and `/socket.io/` transport through that
origin. This matches the production defaults for both client URLs and the
server's `SameSite=Lax` authentication cookie. Evaluate backend proxy rules
before the SPA fallback so API requests never receive `index.html`. Production
must use HTTPS because the server marks the authentication cookie as `Secure`.

A genuinely cross-site client and API deployment is not supported by
configuration alone: the current authentication cookie policy prevents
cross-site credential delivery. Such a topology requires an explicit security
review and coordinated server changes to CORS, cookie attributes, TLS, and CSRF
protection.

For static caching, keep `index.html` revalidatable and allow long-lived caching
for Vite's content-hashed assets.
