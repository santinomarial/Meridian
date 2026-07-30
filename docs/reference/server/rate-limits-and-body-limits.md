# Rate limits and body limits

## HTTP throttlers

Both throttlers use Nest's in-memory storage and are applied by a global guard.

| Name | Default | Scope |
|---|---:|---|
| `default` | `HTTP_LIMIT=120` per `HTTP_TTL_SECONDS=60` | Every HTTP endpoint |
| `auth` | `AUTH_LIMIT=10` per `AUTH_TTL_SECONDS=60` | Every route in `AuthController`, in addition to `default` |

Users, workspaces, documents, invites, health, metrics, and E2E cleanup skip the
`auth` throttler but retain `default`. `E2E_TEST=true` raises both configured
limits to 100,000 without changing their windows.

Counters are process-local. `TRUST_PROXY` controls whether Express trusts
forwarded client IP information; it does not make limits distributed.

## Socket.IO rate limits

The limiter is a per-socket fixed one-second window.

| Budget | Default | Metered events | Unmetered |
|---|---:|---|---|
| Editor | `WS_MESSAGE_LIMIT_PER_SECOND=50` | `joinDocument`, `joinWorkspace`, `chat:message`, `yjs:sync`, `yjs:update`, `awareness:update` | `leaveDocument` |
| Terminal | `WS_MESSAGE_LIMIT_PER_SECOND=50` | `terminal:start`, `terminal:run-file`, `terminal:input`, `terminal:resize` | `terminal:stop` |

Editor and terminal budgets use separate keys for the same socket. Exceeding a
budget drops the event and emits `error` or `terminal:error`.
`E2E_TEST=true` raises each budget to 100,000.

Binary `yjs:sync`, `yjs:update`, and `awareness:update` payloads are each capped
at `WS_MAX_YJS_UPDATE_BYTES` (default 1,048,576). Chat text is 1–2,000
characters. Terminal input is at most 16,384 UTF-16 code units per event.

## HTTP parser limits

The application is created with Nest's default body parser disabled. Express
parsers are registered in this order:

| Request path/scope | JSON wire limit |
|---|---:|
| `/workspaces/:workspaceId/documents/bulk` | 26 MiB |
| `/workspaces/:workspaceId/documents` | 7 MiB |
| `/documents/:documentId` | 7 MiB |
| All other JSON requests | 100 KiB |
| All URL-encoded requests | 100 KiB |

Malformed JSON becomes 400 with `Malformed JSON request body`; an oversized
body becomes 413 with `Request body is too large`. Parsing precedes Nest guards,
throttling, and DTO validation.

## Document semantic limits

These checks are independent of wire size.

| Resource | Limit |
|---|---:|
| Content per file | 1 MiB UTF-8 |
| Bulk import files | 1,000 |
| Bulk import documents (files + folders) | 2,000 |
| Bulk aggregate content | 25 MiB UTF-8 |
| Bulk DTO array | 1–2,000 entries |
| Bulk database transaction timeout | 60 seconds |
| Export files | 1,000 |
| Export documents | 2,000 |
| Export source content | 25 MiB |
| Final ZIP archive | 25 MiB |
| Document path | 4,096 UTF-8 bytes |
| Path segment/name | 255 UTF-8 bytes |
| Path depth | 64 segments |

The browser import path additionally rejects ZIP input over 100 MiB and checks
the same 1 MiB/file, 25 MiB decoded, 1,000-file, 2,000-document, and path
limits before upload. Server limits remain authoritative.

See [HTTP API](http-api.md) for affected routes and
[scaling/failure model](../../explanation/scaling-and-failure-model.md) for
deployment-wide rate-control constraints.
