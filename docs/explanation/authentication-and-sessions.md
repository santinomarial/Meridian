# Authentication and sessions

Meridian combines signed JWTs with database-backed sessions. The JWT makes
identity portable across API replicas; the `Session` row makes logout,
password reset, expiry, and account changes revocable before the JWT's
cryptographic expiry.

## Registration and email verification

Production registration hashes the password with Argon2id, creates an
unverified user and a one-time verification token in one transaction, and sends
the raw token only in a mail URL. PostgreSQL stores only the SHA-256 token hash.
Registration does not create a session until verification succeeds.

Verification conditionally claims a still-unused, unexpired token in a
transaction, sets `User.emailVerifiedAt`, invalidates sibling verification
tokens, and then creates the first session. Concurrent verification requests
cannot both consume the same token. Login and every HTTP or Socket.IO session
check reject users whose email remains unverified. Resend responses are generic
so callers cannot determine whether an address has an account.

Production always enables this flow and startup validation requires a Resend
key and a sender on a verified non-testing domain. Development and test default
to trusted local addresses so they remain usable without external mail; setting
`EMAIL_VERIFICATION_REQUIRED=true` exercises the production registration flow
and exposes a preview link when no development provider is configured. Existing
accounts are marked verified by the migration that introduces this model.

## Session lifecycle

Successful verification and login create a session identified by a random JTI
and sign a JWT containing the user ID, email, and JTI. The persisted session
expiry is derived from the signed token's `exp`, so the two clocks agree.

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
cookie. It verifies the JWT, backing session, session user, verified-email
state, expiry, and revocation before accepting the connection. Because a socket
can outlive a later logout, protected events recheck session and verification
state through a one-second cache. Local and Redis invalidations provide a fast
path; periodic gateway audits are the fallback when an invalidation is missed.
Authorization after identity is covered in
[Authorization and roles](authorization-and-roles.md).

Logout revokes only the current JTI and clears the cookie. Login does not revoke
older sessions, so a verified user may have several active sessions.

## Password reset

Forgot-password responses deliberately do not reveal whether an email exists.
For an existing user, Meridian invalidates prior unused reset tokens, generates
a random raw token, stores only its SHA-256 hash, and applies the configured
expiry to both the database record and email copy.

Reset completion conditionally claims the still-valid token inside a
transaction, replaces the Argon2id password hash, invalidates sibling reset
tokens, and revokes every active session for that user. A cross-process user
invalidation then disconnects or rechecks realtime clients.

Development without a provider can surface preview verification and reset URLs.
Production mail is required for account activation; reset delivery errors are
logged while the forgot-password endpoint keeps its generic response. Invite
creation still returns its shareable URL when invite mail delivery fails.

## Security consequences

The cookie policy is not a cross-site authentication design and there is no
separate CSRF token mechanism. A cross-site deployment needs a deliberate
review of cookie attributes, CORS, HTTPS, and CSRF defenses; configuration
changes alone are insufficient.

Email-bound invites require both an exact case-insensitive address match and a
verified account email. Email-less invite links remain transferable bearer
credentials until their atomic acceptance claim succeeds.

Expired and revoked sessions and used or expired verification/reset tokens are
removed by an hourly retention job. Cleanup limits retained operational data;
it is not part of request-time validity, which is enforced directly from rows.
