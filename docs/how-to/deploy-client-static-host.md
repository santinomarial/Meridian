# Deploy the client to a static host

Deploy the Vite bundle only when the host or its edge proxy can preserve
Meridian's same-origin production topology. A genuinely cross-site client/API
deployment is not supported by configuration alone.

## 1. Build the bundle

For a client served on the same public origin as the API, leave both endpoint
variables empty so the browser uses its current origin.

Working directory: `client/`.

```bash
npm ci
VITE_API_URL= VITE_SOCKET_URL= npm run build
test -f dist/index.html
```

`npm run build` must finish without TypeScript or Vite errors. The final check
must exit silently with status 0. Build-time variables are embedded in public
assets; never put secrets in a `VITE_*` variable.

## 2. Publish `dist/`

Upload only `client/dist/` using the static host's documented deployment
method. Configure:

1. Unknown browser routes to return `index.html` with HTTP 200.
2. `index.html` to revalidate or use `Cache-Control: no-store`.
3. Content-hashed assets under `assets/` to use long-lived immutable caching.
4. HTTPS for the public origin.

Publishing replaces client assets and can leave old tabs on an earlier bundle.
After publishing, open a deep link such as `/workspaces/test`; it must return
the SPA, not a host 404.

## 3. Put the API on the same origin

At the edge, evaluate these backend routes before the SPA fallback:

```text
/auth  /auth/*  /users  /users/*  /workspaces  /workspaces/*
/documents  /documents/*  /invites  /invites/*
/health  /ready  /socket.io  /socket.io/*
```

Proxy them to the Meridian API and enable WebSocket upgrade for `/socket.io/`.
Do not expose `/metrics`, `/docs`, or `/e2e`. Set the server's
`CLIENT_ORIGIN` to the exact public HTTPS origin and configure its trusted proxy
hop count.

Working directory: any directory.

```bash
curl -fsS "https://app.example.com/ready"
curl -sS -o /dev/null -w '%{http_code}\n' "https://app.example.com/workspace/deep-link-check"
```

Replace `app.example.com` before running. Readiness must return HTTP 200. The
deep-link check must print `200` and return HTML; if it returns an API error or
404, fix route ordering or SPA fallback before release.

Sign in and confirm both an authenticated API request and a live editor
connection work after a hard refresh.

For the bundled implementation, see [Client CSP](../reference/client/csp.md),
[Containers and Compose](../reference/operations/containers-and-compose.md),
and [`client/nginx.conf`](../../client/nginx.conf).
