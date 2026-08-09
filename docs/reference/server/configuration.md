# Server configuration

`server/src/config/env.validation.ts` validates the following 28 application
variables at startup. Numeric values marked positive must be integers greater
than zero.

## Application environment (28)

| Variable | Default / requirement | Valid values and use |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `PORT` | `3000` | Positive listen port for HTTP and Socket.IO |
| `CLIENT_ORIGIN` | `http://localhost:5173` | URL used for links and non-development CORS |
| `DATABASE_URL` | Required | Non-empty Prisma PostgreSQL URL |
| `REDIS_URL` | `redis://localhost:6379` | Redis publisher/subscriber URL |
| `JWT_SECRET` | Required | String of at least 16 characters |
| `JWT_EXPIRES_IN` | `7d` | JWT and database-session lifetime: non-negative integer plus `ms`, `s`, `m`, `h`, `d`, `w`, or `y` (for example `15m`, `1h`, `7d`) |
| `LOG_LEVEL` | `info` | Pino level |
| `DOC_TEARDOWN_GRACE_MS` | `30000` | Positive delay before an unused in-memory Yjs document is destroyed |
| `SNAPSHOT_EVERY_N_UPDATES` | `100` | Positive local persisted-update count between compaction attempts |
| `HTTP_TTL_SECONDS` | `60` | Positive default HTTP throttle window |
| `HTTP_LIMIT` | `120` | Positive request count in the default window |
| `AUTH_TTL_SECONDS` | `60` | Positive auth throttle window |
| `AUTH_LIMIT` | `10` | Positive request count in the auth window |
| `WS_MESSAGE_LIMIT_PER_SECOND` | `50` | Positive fixed-window editor/terminal event budget |
| `WS_MAX_YJS_UPDATE_BYTES` | `1048576` | Positive binary cap for sync, update, and awareness |
| `ENABLE_TERMINAL` | `false` | Exactly `true` enables the PTY feature; production + true is rejected |
| `TRUST_PROXY` | `false` | `true`, `false`, an empty string, or a positive integer hop count |
| `REDIS_REQUIRED` | `false` | Exactly `true` makes Redis a readiness requirement |
| `REDIS_KEY_PREFIX` | empty | Trimmed; a non-empty value is normalized to end in `:` |
| `METRICS_ENABLED` | `true` | Exactly `true` exposes `/metrics`; other strings disable it |
| `RESEND_API_KEY` | Unset outside production; required in production | Trimmed; blank becomes unset |
| `MAIL_FROM` | `Meridian <no-reply@meridian.local>` outside production; required in production | Sender used by Resend; production requires a verified custom domain rather than `@resend.dev` or `@meridian.local` |
| `MAIL_TIMEOUT_MS` | `10000` | Positive Resend request timeout in milliseconds, capped at `60000` |
| `EMAIL_VERIFICATION_REQUIRED` | `true` in production; `false` otherwise | `true` or `false`; production explicitly rejects `false` |
| `EMAIL_VERIFICATION_TTL_MINUTES` | `1440` | Positive email-verification-token lifetime |
| `FORGOT_PASSWORD_TTL_MINUTES` | `30` | Positive reset-token lifetime |
| `E2E_TEST` | `false` | `true` or `false`; `true` is rejected in production |

`AppConfig` exposes every variable above except `E2E_TEST`; E2E checks read that
value directly from `process.env`. In development, CORS is the fixed allowlist
for `localhost` and `127.0.0.1` ports 5173–5175. In test and production, the
allowed origin is exactly `CLIENT_ORIGIN`.

Production startup fails when verification is disabled, mail credentials are
missing, or the sender is not on a custom domain. This makes mailbox ownership
verification a deployment invariant rather than an optional runtime feature.

## Seed scope

| Variable | Default | Use |
|---|---|---|
| `MERIDIAN_SEED_PASSWORD` | `Meridian1!` outside production | Password assigned to the four demo users; required when `NODE_ENV=production` |

The seed also reads `NODE_ENV`. It rewrites demo credentials/content and CRDT
history and is intended for disposable data.

## Browser E2E scope

| Variable | Default | Use |
|---|---|---|
| `MERIDIAN_BASE_URL` | `http://localhost:5173` | Playwright browser and Vite URL |
| `MERIDIAN_BACKEND_URL` | `http://localhost:3000` | Backend probe/helper URL |
| `CI` | unset | Playwright focused-test/retry behavior |
| `E2E_TEST` | `false` | Server test routes and 100,000 HTTP/socket limits |
| `ENABLE_TERMINAL` | `false` | Required for terminal browser scenarios |

## Realtime load scope

| Variable | Default | Constraint |
|---|---|---|
| `LOAD_BASE_URL` | `http://127.0.0.1:3100` | HTTP(S) target |
| `LOAD_CONCURRENCY` | `10,25,50,100` | Comma-separated integers, each 1–1000 |
| `LOAD_UPDATES_PER_USER` | `5` | Positive integer |
| `LOAD_ACK_TIMEOUT_MS` | `30000` | Integer at least 1000 |
| `LOAD_PROVISION_BATCH_SIZE` | `5` | Integer 1–1000 |
| `LOAD_USERS_PER_DOCUMENT` | `0` | Zero or positive integer; zero shares one document |
| `LOAD_ALLOW_REMOTE` | unset | Must equal `true` for a non-loopback target |

## Compose and image-build scope

These variables are consumed by Compose, Caddy, or Docker rather than by
`env.validation.ts`.

| Variable | Default / requirement | Consumer |
|---|---|---|
| `POSTGRES_PASSWORD` | Required | PostgreSQL service and generated `DATABASE_URL` |
| `DOMAIN` | Required | Caddy site address |
| `ACME_EMAIL` | Required by the committed Caddyfile | Caddy ACME contact |
| `API_UPSTREAMS` | `api:3000` | Caddy reverse-proxy upstream list |
| `LB_COOKIE_SECRET` | Required | Caddy signed affinity cookie |
| `VITE_API_URL` | empty | Client build argument |
| `VITE_SOCKET_URL` | empty | Client build argument |
| `CSP_CONNECT_SRC_EXTRA` | empty | Client image CSP substitution |

Production Compose additionally passes application variables including
`CLIENT_ORIGIN`, `JWT_SECRET`, `REDIS_KEY_PREFIX`, `RESEND_API_KEY`, and
`MAIL_FROM`; their semantics remain those in the application table.

See [client configuration](../client/configuration.md) and
[server architecture](../../explanation/server-architecture.md) for runtime
context. `LOG_LEVEL` output and redaction behavior are listed in
[Server logging](logging.md).
