# Client Content-Security-Policy

The production client image adds this header from `client/nginx.conf`:

| Directive | Sources |
|---|---|
| `default-src` | `'self'` |
| `base-uri` | `'self'` |
| `frame-ancestors` | `'none'` |
| `object-src` | `'none'` |
| `script-src` | `'self'` |
| `style-src` | `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com` |
| `img-src` | `'self'`, `data:` |
| `font-src` | `'self'`, `data:`, `https://fonts.gstatic.com` |
| `connect-src` | `'self'` plus `CSP_CONNECT_SRC_EXTRA` |
| `worker-src` | `'self'`, `blob:` |

`CSP_CONNECT_SRC_EXTRA` is a client-image **build argument**. It is substituted
into the Nginx configuration while building the runtime image. The value must
include its leading space, for example:

```text
 https://api.example.com wss://api.example.com
```

The default empty value supports the same-origin Caddy topology. When REST and
Socket.IO use another origin, include the required HTTPS and WSS origins and
set `VITE_API_URL` and `VITE_SOCKET_URL` consistently.

Nginx also sends `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, and
`X-Frame-Options: DENY`. Caddy owns HSTS. The Nest JSON API disables Helmet CSP;
the SPA host owns this policy. See [containers and Compose](../operations/containers-and-compose.md)
and [trust boundaries](../../explanation/trust-boundaries.md).
