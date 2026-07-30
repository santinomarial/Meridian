# Client configuration

## Browser bundle variables

Both values are read through `import.meta.env` and are embedded by Vite at build
time. They are public browser configuration, not secret storage.

| Variable | Development fallback | Production fallback | Consumer |
|---|---|---|---|
| `VITE_API_URL` | `http://localhost:3000` | `window.location.origin` | Credentialed HTTP requests |
| `VITE_SOCKET_URL` | `http://localhost:3000` | `window.location.origin` | Credentialed Socket.IO connection |

An explicitly defined empty string remains an empty string in source builds.
The production Docker build arguments default to empty; that build path is
intended for same-origin routing through Caddy.

The HTTP client sends `credentials: "include"`. Socket.IO uses
`withCredentials: true`, `autoConnect: false`, and allows WebSocket followed by
polling.

## Playwright process variables

These are Node-side test-runner variables; they are not Vite browser variables.

| Variable | Default | Effect |
|---|---|---|
| `MERIDIAN_BASE_URL` | `http://localhost:5173` | Playwright `baseURL` and web-server readiness URL |
| `MERIDIAN_BACKEND_URL` | `http://localhost:3000` | Backend probes, route stubs, cleanup, and E2E helper calls |
| `CI` | unset | Forbids focused tests and enables one retry when truthy |

Keep both browser URLs and `MERIDIAN_BACKEND_URL` pointed at the same test
server when using a non-default port. Server-side variables are listed in
[server configuration](../server/configuration.md). Deployment behavior is
described in [trust boundaries](../../explanation/trust-boundaries.md).
