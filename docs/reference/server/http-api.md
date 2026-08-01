# HTTP API

The API has no global path prefix. JSON DTOs reject unknown fields. Protected
routes accept the `auth_token` cookie first, then
`Authorization: Bearer <token>`; both must identify an active database session.

Swagger UI (`/docs`) and generated OpenAPI JSON (`/docs-json`) exist only when
`NODE_ENV` is **not** `production`. Test-only endpoints are excluded from
Swagger.

Roles are `OWNER`, `EDITOR`, and `VIEWER`. “Member” means any of those roles;
“writer” means owner or editor. Non-members generally receive 404 for private
workspace/document identifiers.

## Health

| Method and path | Auth | Result |
|---|---|---|
| `GET /health` | Public | Process liveness object |
| `GET /ready` | Public | PostgreSQL/Redis readiness; 200 or 503 |
| `GET /metrics` | Public at app layer | Prometheus text, or 404 when disabled |

See [health and metrics](health-and-metrics.md) for exact fields and exposure.

## Authentication

| Method and path | Auth | Body | Success |
|---|---|---|---|
| `POST /auth/register` | Public | `email` (email), `password` (policy), `displayName` (non-empty string) | 201; production returns a pending-verification result without a session; trusted development/test mode returns user + token |
| `POST /auth/verify-email` | Public bearer token | `token` | 200; atomically verifies the email, creates a session, sets cookie, returns user + token |
| `POST /auth/email-verification` | Public | `email` | Generic 200; development fallback may include `previewVerificationUrl` |
| `POST /auth/login` | Public | `email`, `password` | 200 for a verified account; creates session, sets cookie, returns user + token |
| `GET /auth/me` | Session | — | Current authenticated user |
| `POST /auth/logout` | Session | — | 204; revokes current session and clears cookie |
| `POST /auth/forgot-password` | Public | `email` | Generic 200 message; development fallback may include `previewResetUrl` |
| `POST /auth/reset-password` | Public | `token`, `password` (policy) | 200 success message; revokes user sessions |

Password policy: at least eight characters, one uppercase, one lowercase, one
number, and one non-alphanumeric character.

Production sessions require `User.emailVerifiedAt`. Verification and resend
tokens are one-time bearer credentials stored only as SHA-256 hashes.

## Users

| Method and path | Auth/role | Body | Result |
|---|---|---|---|
| `GET /users/:userId` | Session; self or shared-workspace peer | — | Public profile; email is included only for self |
| `PATCH /users/:userId` | Self | Optional `displayName`, `avatarUrl` (string or null) | Updated public profile |
| `DELETE /users/:userId` | Self | — | 204; deletes account and clears cookie |

## Workspaces and members

| Method and path | Auth/role | Body | Result |
|---|---|---|---|
| `GET /workspaces` | Session | — | Current user's workspaces |
| `GET /workspaces/:workspaceId` | Member | — | Workspace |
| `POST /workspaces` | Session | `name` (non-empty); optional deprecated `ownerId` is ignored | 201 workspace owned by caller |
| `PATCH /workspaces/:workspaceId` | Canonical owner | Optional `name` (non-empty) | Updated workspace |
| `DELETE /workspaces/:workspaceId` | Canonical owner | — | 204 |
| `GET /workspaces/:workspaceId/members` | Member | — | Membership list |
| `POST /workspaces/:workspaceId/members` | Canonical owner | `userId`, `role` (`EDITOR` or `VIEWER`) | 201 membership |
| `PATCH /workspaces/:workspaceId/members/:memberId` | Canonical owner | `role` (`EDITOR` or `VIEWER`) | Updated membership |
| `DELETE /workspaces/:workspaceId/members/:memberId` | Canonical owner | — | 204; owner-role and canonical-owner memberships are rejected with 403 |

The canonical owner is both `Workspace.ownerId` and an `OWNER` membership.
Generic member operations cannot assign `OWNER`.

## Documents and versions

`DocumentType` values are `FILE` and `FOLDER`.

| Method and path | Auth/role | Body | Result |
|---|---|---|---|
| `GET /workspaces/:workspaceId/documents` | Member | — | Flat documents ordered by path |
| `GET /workspaces/:workspaceId/documents/tree` | Member | — | Nested document tree |
| `GET /workspaces/:workspaceId/export` | Member | — | ZIP attachment |
| `POST /workspaces/:workspaceId/documents` | Writer | Create-document DTO below | 201 document |
| `POST /workspaces/:workspaceId/documents/bulk` | Writer | `{ documents: CreateDocumentDto[] }`, 1–2000 entries | 201 documents in input order |
| `GET /documents/:documentId` | Member of containing workspace | — | Document |
| `PATCH /documents/:documentId` | Writer | Update-document DTO below | Updated metadata |
| `POST /documents/:documentId/checkpoint` | Writer | — | Checkpoint result; version is created only when saved text changed |
| `DELETE /documents/:documentId` | Writer | — | 204; deletes descendants |
| `GET /documents/:documentId/versions` | Member | — | Version metadata, newest first |
| `GET /documents/:documentId/versions/:versionId` | Member | — | Version with content |
| `POST /documents/:documentId/versions/:versionId/restore` | Writer | — | Restored document and version numbers |

Create-document DTO:

| Field | Required | Validation |
|---|---:|---|
| `parentId` | No | String; bulk import ignores it and resolves parents from paths |
| `type` | Yes | `FILE` or `FOLDER` |
| `path` | Yes | Non-empty string |
| `name` | Yes | Non-empty string |
| `language` | No | String |
| `content` | No | String |

Update-document DTO:

| Field | Required | Behavior |
|---|---:|---|
| `name` | No | String |
| `path` | No | String |
| `language` | No | String or null |
| `parentId` | No | String or null |
| `content` | No | Deprecated and rejected by the service; use `checkpoint` |

The REST text checkpoint is `Document.content`; live collaborative writes use
Socket.IO and become visible to export/version/terminal projection after a
checkpoint. Limits are listed in
[rate limits and body limits](rate-limits-and-body-limits.md).

## Invites

Invites expire seven days after creation. The lifetime is fixed in the service
and is not configurable.

| Method and path | Auth/role | Body | Result |
|---|---|---|---|
| `POST /workspaces/:workspaceId/invites` | Canonical owner | `role` (`EDITOR` or `VIEWER`), optional email | 201 invite and raw share URL; delivery status fields may be present |
| `GET /workspaces/:workspaceId/invites` | Canonical owner | — | Invites without raw tokens |
| `GET /invites/:token` | Public bearer token | — | Invite metadata |
| `POST /invites/:token/accept` | Session | — | Resulting membership |

Acceptance conditionally claims the token and upserts the membership in one
transaction. Email-bound invites also require the authenticated account email
to be verified.

## E2E-only endpoints

These endpoints return 404 unless `E2E_TEST=true` and
`NODE_ENV !== "production"`. They have no caller-authentication guard and must
be used only in isolated test environments.

| Method and path | Body | Scope |
|---|---|---|
| `POST /e2e/cleanup` | `emailPrefix`: one exact allowlisted prefix | Deletes matching synthetic `@example.com` users and owned workspaces |
| `POST /auth/e2e/password-reset-token` | `email`: allowlisted synthetic address | Returns a reset token and URL |

Allowed cleanup prefixes are `e2e-`, `int-auth-`, `int-doc-`,
`int-throttle-`, and `int-workspace-owner-`.

## Error envelope

Application errors normally return `statusCode`, `error`, `message`,
`requestId`, `timestamp`, and a redacted `path`. Unexpected 5xx details are
replaced with `Internal server error`.

For lifecycle and authorization rationale, see
[authentication and sessions](../../explanation/authentication-and-sessions.md),
[authorization and roles](../../explanation/authorization-and-roles.md), and
[document model and save](../../explanation/document-model-and-save.md).
