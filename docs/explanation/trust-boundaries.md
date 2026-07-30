# Trust boundaries

Meridian treats the browser as untrusted and PostgreSQL as the durable
correctness boundary. Every layer between them narrows responsibility but does
not remove the need for server-side authentication, authorization, validation,
and resource limits.

## Boundaries and assumptions

**Browser.** Client role checks, path checks, and size checks improve feedback;
they are not security controls. REST guards and Socket.IO handlers independently
validate protected operations. Awareness identity supplied by a client is
overwritten from the authenticated socket before relay.

**Static host and TLS edge.** The static host delivers the Vite build and owns
SPA fallback. The TLS terminator owns HTTPS and HSTS. The API installs Helmet
with CSP and HSTS disabled because CSP belongs to the SPA response and HSTS to
the HTTPS edge. In production, Swagger is not mounted at all.

**NestJS process.** The process is trusted with credentials, authorization,
database access, loaded Yjs documents, sockets, and—when enabled—host command
execution. Request bodies are parsed before Nest guards and throttlers, so an
ingress must impose authoritative connection, request-size, and abuse limits.
The built-in HTTP throttler is process-local.

**PostgreSQL.** PostgreSQL stores users, sessions, workspace authorization,
documents, versions, and generation-aware Yjs history. Document advisory locks,
transactions, uniqueness constraints, and generation checks provide durable
ordering and restore fencing.

**Redis.** Redis is a trusted internal event bus and sequence accelerator.
Inbound Pub/Sub messages are not re-authenticated against PostgreSQL. Anyone
able to publish into Meridian's channels can inject collaboration, chat,
authorization, restore-control, or terminal-projection events. Every key and
channel can be namespaced with `REDIS_KEY_PREFIX`; logical Redis database
numbers do not isolate Pub/Sub.

**Mail provider.** Resend receives recipient addresses and bearer-action URLs.
Invite and reset URLs must therefore be treated as secrets in mail, browser
history, analytics, and logs. The application redacts invite and reset token
path segments from its request/error logging.

**Terminal host boundary.** The temporary projection and reduced child
environment are not a sandbox. A PTY runs as the API's operating-system user
and can access everything available to that account. Production environment
validation rejects `ENABLE_TERMINAL=true`; non-production use still requires
appropriate host isolation. See [Terminal execution](terminal-execution.md).

## Browser-origin and proxy model

HTTP and Socket.IO both allow credentials. Development accepts only the
hard-coded localhost and `127.0.0.1` origins on ports 5173–5175; test and
production accept the exact configured client origin. The auth cookie is
`SameSite=Lax`, so the intended deployment is same-site. A genuinely cross-site
frontend requires a coordinated cookie, CORS, TLS, and CSRF design; changing an
origin setting alone is insufficient.

Express `trust proxy` is explicitly set from validated `TRUST_PROXY`
configuration. This must match the real proxy topology or client-IP throttling
can key on the proxy—or trust attacker-supplied forwarding headers.

## Consequences

- A Redis outage is not equivalent to PostgreSQL loss: durable per-document
  ordering continues, while cross-replica live delivery degrades.
- A successful client-side check never grants authority.
- A healthy process is not necessarily ready: dependency behavior is explained
  in [Server architecture](server-architecture.md).
- Security-sensitive residual gaps are kept in
  [Known limitations](../reference/known-limitations.md), with rationale linked back here
  rather than duplicated.
