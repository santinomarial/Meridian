# Meridian architecture

This document describes the behavior implemented in this repository. It is not
a production deployment specification and does not describe unimplemented
controls as if they exist.

The primary implementation references are:

- [client application entry point](../client/src/App.tsx)
- [server bootstrap](../server/src/main.ts)
- [server application setup](../server/src/app.setup.ts)
- [Prisma schema](../server/prisma/schema.prisma)
- [realtime gateway](../server/src/modules/realtime/editor.gateway.ts)
- [document persistence](../server/src/modules/realtime/document-persistence.service.ts)
- [terminal gateway](../server/src/modules/terminal/terminal.gateway.ts)
- [CI workflow](../.github/workflows/ci.yml)

For setup and API-oriented usage, see the [repository README](../README.md),
[client README](../client/README.md), and [server README](../server/README.md).

## 1. System context

Meridian consists of two independently built applications:

1. A React single-page application built as static files by Vite.
2. A NestJS process that serves REST, Swagger, and Socket.IO on one HTTP
   listener.

The NestJS process does not serve the client build. A local or production
environment must host the static client separately and route browser API and
Socket.IO traffic to the server.

~~~mermaid
flowchart LR
    Browser["Browser<br/>React, Zustand, Monaco, Yjs"]
    StaticHost["Static web host<br/>Vite build output"]
    Api["Meridian server<br/>NestJS REST and Socket.IO"]
    Pg[("PostgreSQL<br/>application and document data")]
    Redis[("Redis<br/>coordination and sequence counters")]
    Mail["Resend API<br/>optional email delivery"]
    Temp["Host temporary filesystem<br/>terminal projections"]
    Pty["Host PTY and runtimes<br/>optional terminal execution"]

    Browser -->|"GET static assets"| StaticHost
    Browser -->|"HTTP JSON and cookies"| Api
    Browser <-->|"Socket.IO"| Api
    Api -->|"Prisma queries and transactions"| Pg
    Api <-->|"pub/sub and counters"| Redis
    Api -.->|"email requests when configured"| Mail
    Api -.->|"materialize saved files"| Temp
    Api -.->|"spawn shell and run files"| Pty
~~~

PostgreSQL is required. Redis is optional only for a deliberately
single-process deployment. Mail and terminal execution are optional features.
TLS termination, static hosting, DNS, load balancing, database backups, and
secret distribution are outside this repository.

## 2. Deployment and trust boundaries

| Boundary | Trust and responsibility |
|---|---|
| Browser | Untrusted input source. Client-side role checks and size checks improve UX but are not authorization controls. The server must validate every protected operation. |
| Static host | Delivers the Vite assets and must provide SPA fallback for browser routes. It is not implemented by the NestJS server. |
| NestJS process | Authentication, authorization, validation, document coordination, and optional host command execution occur here. A process owns its sockets, loaded Yjs documents, rate-limit state, and PTYs. |
| PostgreSQL | Durable store for users, sessions, workspaces, documents, versions, Yjs updates, and Yjs snapshots. It is required for readiness. |
| Redis | Best-effort cross-process message fan-out plus shared document sequence counters. It is not document storage and pub/sub has no replay. Multiple replicas are not safe without it, and current multi-replica persistence and restore limitations remain even with it. |
| Mail provider | Receives email addresses and action links when Resend is configured. Development without a provider logs action URLs; other environments report delivery failures internally. |
| PTY and temporary filesystem | High-risk boundary. A terminal shell runs as the server OS user. The temporary working directory and reduced environment are not an OS sandbox. |

In non-development environments, HTTP and Socket.IO CORS allow exactly
<code>CLIENT_ORIGIN</code> with credentials. Development allows only the
hard-coded localhost and 127.0.0.1 origins on ports 5173 through 5175.

## 3. Client architecture

### 3.1 Routing and build output

<code>BrowserRouter</code> defines these browser routes:

| Route | Page |
|---|---|
| <code>/</code> | Landing, registration, and login |
| <code>/forgot-password</code> | Landing page in password-reset-request mode |
| <code>/workspace</code> | Default workspace |
| <code>/workspace/:workspaceId</code> | Specific workspace |
| <code>/session/:id</code> | Workspace page compatibility route |
| <code>/invite/:inviteId</code> | Invite details and acceptance |
| <code>/reset-password/:token</code> | Password reset |

Workspace, invite, and reset pages are lazy-loaded. An unknown client-side
route redirects to <code>/</code>, but direct requests first reach the static
host; that host must rewrite unknown paths to <code>index.html</code>.

The browser resolves REST and Socket.IO endpoints independently:

- <code>VITE_API_URL</code> configures REST.
- <code>VITE_SOCKET_URL</code> configures Socket.IO.
- Development falls back to <code>http://localhost:3000</code>.
- A production build without either variable uses the page origin.

REST requests send <code>credentials: include</code>. The Socket.IO client also
sends credentials and allows both WebSocket and long-polling transports.

### 3.2 State and data flow

~~~mermaid
flowchart TD
    Route["React route"]
    Loader["useBackendWorkspace"]
    Rest["REST client"]
    Store["Zustand workspace store"]
    Tree["File explorer and tabs"]
    Monaco["Monaco model"]
    Session["useSessionSocket"]
    Binding["useYjsMonaco and y-monaco"]
    YDoc["Per-document client Y.Doc and Awareness"]
    Socket["Singleton Socket.IO client"]

    Route --> Loader
    Loader -->|"auth, workspaces, members, tree"| Rest
    Rest --> Store
    Store --> Tree
    Store --> Monaco
    Store --> Session
    Monaco <--> Binding
    Binding <--> YDoc
    Session <--> YDoc
    Session <--> Socket
    Binding <--> Socket
~~~

Workspace startup checks <code>/auth/me</code>, lists workspaces, selects the
requested or default workspace, reads member roles, then loads the document
tree and saved content. A fresh authenticated account with no workspace causes
the client to create <code>My Workspace</code>. A missing deep-linked workspace
returns to <code>/workspace</code> instead of silently opening another one.

An HTTP 401 during the authentication check redirects to the landing page.
Other backend-loading failures set the backend state to unavailable and expose
the in-memory demo workspace. Demo edits, chat, and file operations are local
to the browser and are not server-durable. When the backend is pending or
available, role checks fail closed; viewers are read-only.

The client first loads saved text over REST. When collaboration is available,
it waits for the server's Yjs sync response before constructing
<code>MonacoBinding</code>. This prevents an empty client <code>Y.Doc</code>
from replacing the REST-loaded Monaco model. Local Yjs updates are merged for
50 ms before send; awareness updates are coalesced for 80 ms.

Client <code>Y.Doc</code> and <code>Awareness</code> instances are held in
module-level maps. Leaving a document removes listeners and room membership,
but it does not destroy or remove those objects. A browser session that opens
many documents retains their CRDT state until the page reloads.

## 4. Server architecture

### 4.1 Module boundaries

| Area | Main responsibility |
|---|---|
| Auth and users | Registration, login, database-backed sessions, password reset, profile changes, and account deletion |
| Workspaces and invites | Workspace ownership, membership roles, owner-only administration, and bearer invite links |
| Documents | File tree CRUD, bulk import, ZIP export, plain-text saves, version history, and restore |
| Realtime | Socket authentication, document and workspace rooms, Yjs sync/update relay, awareness, chat, in-memory documents, and asynchronous persistence |
| Realtime authorization | Short-lived session cache, local invalidation, and Redis invalidation fan-out |
| Terminal | Optional PTY lifecycle, run-file dispatch, temporary workspace projection, and cross-instance projection sync |
| Prisma | PostgreSQL connection lifecycle and typed database access |
| Redis | Two ioredis connections, pattern subscriptions, publication, and atomic sequence allocation |

Swagger is exposed at <code>/docs</code> in every environment. The repository
does not disable or authenticate it in production. Test-only controllers are
excluded from the generated Swagger document.

### 4.2 HTTP request pipeline

The route-specific Express JSON parsers are registered before Nest guards and
controller validation:

~~~mermaid
flowchart LR
    Request["HTTP request"]
    Parser["Route JSON parser<br/>then default parser"]
    Cookie["Cookie parser"]
    RequestId["RequestIdMiddleware"]
    Throttle["Global ThrottlerGuard"]
    Auth["Route JwtAuthGuard<br/>when protected"]
    Validate["Global ValidationPipe"]
    Controller["Controller and service"]
    Db[("PostgreSQL")]
    Filter["Global exception filter"]

    Request --> Parser --> Cookie --> RequestId --> Throttle --> Auth --> Validate --> Controller --> Db
    Parser -.-> Filter
    Throttle -.-> Filter
    Auth -.-> Filter
    Validate -.-> Filter
    Controller -.-> Filter
~~~

This order matters: body bytes can be accepted and parsed before authentication
or Nest throttling. Reverse proxies should impose request-size and request-rate
limits before forwarding traffic.

The global validation pipe transforms DTOs, rejects unknown properties, and
uses <code>class-validator</code>. The exception filter returns:

~~~json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Example message",
  "requestId": "request correlation value",
  "timestamp": "ISO-8601 timestamp",
  "path": "/request/path"
}
~~~

Uncaught 5xx details are masked from clients and logged. Request IDs come from
the inbound <code>X-Request-Id</code> header or a generated UUID and are echoed
in the response. The inbound value is accepted as supplied, so it is a
correlation aid, not an authenticated identifier. A parser failure can occur
before the Nest request-ID middleware and can therefore have an empty ID.

### 4.3 HTTP throttling

Two named in-memory throttlers are configured:

| Throttler | Default | Scope |
|---|---:|---|
| <code>default</code> | 120 requests per 60 seconds | All HTTP endpoints |
| <code>auth</code> | 10 requests per 60 seconds | Auth controller in addition to the default limit |

Non-auth controllers skip the <code>auth</code> throttler. Health and readiness
still use the default throttler. <code>E2E_TEST=true</code> raises both limits
to 100,000.

The storage is process-local and the app does not configure Express
<code>trust proxy</code>. These limits are not a global abuse-control boundary
and may identify a reverse proxy rather than the originating client. A
production ingress needs its own controls and an explicit trusted-proxy review.

## 5. Authentication and session lifecycle

Passwords are hashed with Argon2id. Register and login create a
<code>Session</code> row and sign a JWT containing <code>sub</code>,
<code>email</code>, and <code>jti</code>. The JWT expiry and session expiry are
aligned. The default lifetime is seven days.

Register and login return the JWT in the JSON response and set it in the
<code>auth_token</code> cookie. The bundled client relies on the cookie and
does not persist the returned bearer token. Cookie properties are:

- <code>HttpOnly</code>
- <code>SameSite=Lax</code>
- <code>Secure</code> only when <code>NODE_ENV=production</code>
- <code>Path=/</code>

The HTTP guard prefers the cookie and otherwise accepts an
<code>Authorization: Bearer</code> token. It verifies the JWT and reads the
session row on every guarded HTTP request, rejecting missing, expired, or
revoked sessions. A rejected cookie token is cleared.

Socket.IO authentication accepts <code>handshake.auth.token</code> first and
then <code>auth_token</code> from the Cookie header. The handshake verifies the
JWT, session, session user, expiry, and revocation before connection.

Logout revokes the current session and publishes a realtime invalidation.
Password reset uses a random raw token while storing only its SHA-256 hash.
The reset transaction conditionally claims the token, changes the Argon2id
password, invalidates sibling reset tokens, and revokes every user session.
The forgot-password response is intentionally the same whether the account
exists or not.

There is no email verification flow. There is also no scheduled deletion of
expired or revoked sessions, expired or used reset tokens, or expired invites.
Those rows remain until related users or workspaces are deleted or an operator
adds a maintenance process.

### Mail behavior

When <code>RESEND_API_KEY</code> is present, password reset and invite messages
are sent through the Resend HTTP API. Development without a key prints the
action URL. In other environments without a key, sending throws internally.
Password-reset requests still return the generic response, and invite creation
still returns the shareable link; the delivery failure is logged.

The cookie policy is suitable for a same-site frontend/API deployment. A
cross-site deployment requires a deliberate cookie and CSRF design change.
There is no separate CSRF token mechanism in this code.
