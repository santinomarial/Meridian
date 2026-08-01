# Server logging

Logging is configured by `server/src/config/logger.config.ts` through
`nestjs-pino`.

## Output

| Setting | Behavior |
|---|---|
| `LOG_LEVEL` | Pino level; defaults to `info` |
| `NODE_ENV=development` | `pino-pretty`, colorized, multiline timestamps, with `pid` and `hostname` omitted |
| Other environments | Structured Pino JSON on standard output |

HTTP logs include method, redacted URL, and `requestId`. An incoming
`X-Request-Id` is reused in logs and returned in the response header. Without
that header, Pino and request-ID middleware currently generate UUIDs
independently, so the response's `X-Request-Id` can differ from the request-log
ID. Supply a trusted ingress correlation ID when stable end-to-end matching is
required. Request IDs are correlation metadata, not authenticated identity.

JSON parsing runs before request-ID middleware, so malformed or oversized
bodies rejected by the parser may not receive the response header.

## Redaction

Pino replaces these structured paths with `[REDACTED]`:

- `req.headers.authorization`
- `req.headers.cookie`
- `req.body.password`
- `req.body.passwordHash`
- `req.body.token`
- `res.headers["set-cookie"]`

The request serializer also redacts bearer values in:

- `/invites/:token`
- `/verify-email/:token`
- `/reset-password/:token`
- `token` and `inviteToken` query parameters

Redaction covers the configured request fields and URL patterns, not arbitrary
application log arguments. Do not log DTOs, secrets, invitation, verification,
or reset URLs, cookies, or tokens directly.

For HTTP error fields, see the [HTTP API](http-api.md#error-envelope). For the
deployment trust boundary, see
[Trust boundaries](../../explanation/trust-boundaries.md).
