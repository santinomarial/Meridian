# Authentication and sessions

Meridian combines signed JWTs with database-backed sessions. The JWT makes
identity portable across API replicas; the `Session` row makes logout,
password reset, expiry, and account changes revocable before the JWT's
cryptographic expiry.

## Session lifecycle

Registration and login hash or verify passwords with Argon2id, create a session
identified by a random JTI, and sign a JWT containing the user ID, email, and
JTI. The persisted session expiry is derived from the signed token's `exp`, so
the two clocks agree.

The response returns the token and sets it as `auth_token`. The bundled browser
client relies on the cookie:

- `HttpOnly` prevents ordinary browser script access;
- `SameSite=Lax` supports the intended same-site frontend/API topology;
- `Secure` is enabled in production; and
- the cookie is scoped to `/`.

HTTP authentication prefers the cookie and otherwise accepts a bearer token.
The guard verifies the JWT and loads the exact session row on every protected
request, rejecting missing, expired, or revoked sessions. A rejected cookie is
cleared so the browser does not keep presenting known-dead state.

Socket.IO accepts a handshake bearer token first and otherwise reads the same
cookie. It verifies the JWT, backing session, session user, expiry, and
revocation before accepting the connection. Because a socket can outlive a
later logout, protected events recheck session state through a one-second cache.
Local and Redis invalidations provide a fast path; periodic gateway audits are
the fallback when an invalidation is missed. Authorization after identity is
covered in [Authorization and roles](authorization-and-roles.md).

Logout revokes only the current JTI and clears the cookie. Login and
registration do not revoke older sessions, so a user may have several active
sessions.

## Password reset

Forgot-password responses deliberately do not reveal whether an email exists.
For an existing user, Meridian invalidates prior unused reset tokens, generates
a random raw token, stores only its SHA-256 hash, and applies the configured
expiry to both the database record and email copy.

Reset completion conditionally claims the still-valid token inside a
transaction, replaces the Argon2id password hash, invalidates sibling reset
tokens, and revokes every active session for that user. A cross-process user
invalidation then disconnects or rechecks realtime clients.

Mail delivery is optional infrastructure. Development without a provider can
surface a preview URL. Outside development, delivery errors are logged while
the forgot-password endpoint keeps its generic response. An invitation creation
still returns its shareable URL when invite email delivery fails.

## Security consequences

The cookie policy is not a cross-site authentication design and there is no
separate CSRF token mechanism. A cross-site deployment needs a deliberate
review of cookie attributes, CORS, HTTPS, and CSRF defenses; configuration
changes alone are insufficient.

Registration does not verify control of the supplied email address. Email is
therefore an account identifier, not proof of a verified external identity.
This matters for email-bound invites: they bind to the account's stored email,
whose ownership Meridian has not independently verified.

Expired and revoked sessions and used or expired reset tokens are removed by an
hourly retention job. Cleanup limits retained operational data; it is not part
of request-time validity, which is enforced directly from the row.
