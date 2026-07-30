# Meridian client

The React and TypeScript single-page application for Meridian's authenticated
workspace, Monaco editor, collaboration UI, and terminal UI.

For a complete first run, follow the
[getting-started tutorial](../docs/tutorials/getting-started.md). The client
needs a running [Meridian server](../server/README.md) for persistent features.

## Run locally

From the repository root:

```bash
cd client
npm ci
npm run dev
```

Vite serves the client at `http://localhost:5173`. Development REST and
Socket.IO connections default to `http://localhost:3000`.

Set `VITE_API_URL` and `VITE_SOCKET_URL` at build time to override those
endpoints. Vite exposes `VITE_` values to browsers, so never put secrets in
them.

## Commands

Run all commands from `client/`:

- `npm run dev` — start Vite.
- `npm run build` — run the TypeScript project build and create `dist/`.
- `npm run preview` — serve the current production bundle locally.
- `npm run lint` — run ESLint.
- `npm test` / `npm run test:watch` — run Vitest once / in watch mode.
- `npm run test:e2e` — run Playwright.
- `npm run test:e2e:ui` / `npm run test:e2e:headed` — run Playwright
  interactively / with a visible browser.

The usual package check is:

```bash
npm run lint
npm test
npm run build
```

The full Playwright suite requires the server's isolated E2E mode; see
[Contributing](../CONTRIBUTING.md#end-to-end-tests).

## Learn more

- [Client commands](../docs/reference/client/commands.md)
- [Client configuration](../docs/reference/client/configuration.md)
- [Client source layout](../docs/reference/client/source-layout.md)
- [Client architecture](../docs/explanation/client-architecture.md)
- [Deploy the client to a static host](../docs/how-to/deploy-client-static-host.md)
- [Documentation map](../docs/README.md)
