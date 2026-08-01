# Security policy

## Report a vulnerability privately

Do not disclose a suspected vulnerability in a public issue, discussion, pull
request, or chat.

Use a [GitHub private security advisory](https://github.com/santinomarial/Meridian/security/advisories/new)
for this repository. If that feature is unavailable, contact a repository
maintainer privately through a contact method published on their GitHub profile
before sharing technical details.

This repository does not configure a security email address or another private
reporting address, so this policy cannot name one. Do not guess an address.

Include the affected commit or deployment, prerequisites, reproduction steps,
impact, and any suggested mitigation. Remove credentials, personal data, and
unrelated secrets from evidence.

No response or remediation time is promised. There is currently no published
release support schedule; reports should identify the exact commit or deployed
version they affect.

## Security-sensitive runtime boundaries

### Integrated terminal

`ENABLE_TERMINAL` defaults to `false`, and configuration validation rejects
`ENABLE_TERMINAL=true` when `NODE_ENV=production`. In a non-production process,
the terminal starts a host `node-pty` shell as the server's operating-system
user.

Its temporary working directory, reduced environment, path validation, and
authorization checks are not a container, virtual machine, namespace, syscall,
network, CPU, or memory isolation boundary. Terminal changes are not written
back to PostgreSQL or Yjs. Keep the feature on isolated, disposable systems and
away from untrusted multi-tenant workloads.

### End-to-end test mode

Configuration validation rejects `E2E_TEST=true` in production. E2E helper
routes return `404` unless `E2E_TEST=true` in a non-production process. When
enabled, the mode raises rate limits and exposes scoped cleanup and
password-reset helpers without separate caller authentication.

The helpers restrict their targets to test email patterns, but an E2E server
must still use a disposable database and an isolated network. It must never
serve normal users or share production data.

### Swagger and OpenAPI

The server registers Swagger only when `NODE_ENV` is not `production`.
`/docs` and `/docs-json` have no application-level authentication in those
environments and disclose the API surface. Do not expose a development or test
server publicly merely because production disables these routes.

## Other deployment assumptions

- Terminate TLS at a trusted ingress. Production authentication cookies are
  `HttpOnly`, `SameSite=Lax`, and `Secure`.
- Keep PostgreSQL and Redis private. Redis messages are trusted internal input,
  and Redis Pub/Sub is coordination rather than durable storage.
- Treat email-verification, invitation, and password-reset URLs as bearer
  credentials and keep them out of analytics and logs where possible.
- Configure trusted-proxy handling and enforce authoritative request-size,
  connection, timeout, and abuse limits at the ingress. Application HTTP
  throttling is process-local.
- Prefer the documented single-server topology unless the multi-replica
  requirements and known failure modes have been evaluated.

See [Deploy with Docker Compose](docs/how-to/deploy-with-docker-compose.md) and
[Trust boundaries](docs/explanation/trust-boundaries.md) for the deployment
model.
