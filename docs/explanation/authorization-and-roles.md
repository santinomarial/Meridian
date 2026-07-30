# Authorization and roles

Authorization is workspace-scoped. Authentication establishes the user and
session; a `WorkspaceMember` row supplies one of three roles:

| Capability | OWNER | EDITOR | VIEWER |
|---|:---:|:---:|:---:|
| Read workspace, documents, versions, export, chat, and presence | Yes | Yes | Yes |
| Create, import, rename, delete, checkpoint, restore, or send Yjs writes | Yes | Yes | No |
| Use the optional terminal | Yes | Yes | No |
| Rename/delete the workspace or manage members and invites | Yes | No | No |

This matrix is enforced in REST controllers and Socket.IO gateways. Client-side
checks only control presentation.

## Canonical ownership

Workspace ownership is represented twice on purpose:

- `Workspace.ownerId` names the canonical owner; and
- the matching membership has role `OWNER`.

Workspace rename, workspace deletion, and member-management checks require both
facts. Generic membership APIs cannot assign, demote, or remove an `OWNER` or
the canonical owner's membership. The canonical owner must use the workspace
deletion endpoint; there is no leave-with-transfer operation.

Invite creation and listing currently check the caller's membership role, not
`Workspace.ownerId`. A malformed or legacy extra `OWNER` membership can
therefore manage invites even though it cannot rename the workspace or manage
members. This inconsistency is tracked in
[Known limitations](../reference/known-limitations.md).

Private-resource lookups generally return 404 to non-members so workspace,
document, version, and profile identifiers are not useful enumeration oracles.
An existing member whose role lacks a requested capability receives 403.

Connected sockets are not trusted indefinitely. Protected editor and terminal
events revalidate the active session and current role, with short successful
caches. Membership changes publish local and Redis invalidations, and periodic
audits remove passive room or terminal access if a message was missed.

## Invitation authority

Members with role `OWNER` can create or list invitations. An invite can grant
`EDITOR` or `VIEWER`, never `OWNER`. Its random raw token is a bearer credential
returned only at creation; PostgreSQL stores a SHA-256 hash.

Acceptance enforces three independent constraints:

1. the invite has not expired;
2. `acceptedAt` is still null, normally making the token single-use; and
3. when an invite email is present, it matches the authenticated account email
   case-insensitively.

The acceptance check and update are not conditionally serialized, so concurrent
redemptions are not a strong single-use guarantee. An email-less invite is
transferable until acceptance is recorded. An email-bound invite is still only
as strong as Meridian's unverified account email model; see
[Authentication and sessions](authentication-and-sessions.md).

## User data exposure

Authenticated users can read their own profile. A user who shares a workspace
with the target can read the target's profile fields but not their email.
Unrelated users receive 404. Account deletion removes owned workspaces before
deleting the user because the owner relation is intentionally restrictive;
dependent memberships, sessions, tokens, invites, documents, and versions then
follow the schema's cascade or set-null rules.

The underlying ownership and relation constraints are shown in
[Data model](data-model.md). Realtime enforcement details are in
[Realtime collaboration](realtime-collaboration.md).
