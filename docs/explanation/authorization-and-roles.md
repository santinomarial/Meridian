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

Workspace rename, deletion, member management, and invite management all call
the same canonical management check and require both facts. Generic membership
APIs cannot assign, demote, or remove an `OWNER` or the canonical owner's
membership. The canonical owner must use the workspace deletion endpoint;
there is no leave-with-transfer operation.

Private-resource lookups generally return 404 to non-members so workspace,
document, version, and profile identifiers are not useful enumeration oracles.
An existing member whose role lacks a requested capability receives 403.

Connected sockets are not trusted indefinitely. Protected editor and terminal
events revalidate the active session and current role, with short successful
caches. Membership changes publish local and Redis invalidations, and periodic
audits remove passive room or terminal access if a message was missed.

## Invitation authority

Only the canonical owner can create or list invitations. An invite can grant
`EDITOR` or `VIEWER`, never `OWNER`. Its random raw token is a bearer credential
returned only at creation; PostgreSQL stores a SHA-256 hash.

Acceptance enforces three independent constraints:

1. the invite has not expired;
2. an atomic conditional update changes `acceptedAt` from null exactly once;
3. when an invite email is present, it matches the authenticated account email
   case-insensitively; and
4. an email-bound invite requires that account email to be verified.

The claim and membership upsert run in one transaction. If two users submit the
same token concurrently, one claim succeeds and the other returns Gone without
creating a membership. An email-less invite remains transferable until the
winning acceptance transaction records the claim. See
[Authentication and sessions](authentication-and-sessions.md) for verified
identity and session behavior.

## User data exposure

Authenticated users can read their own profile. A user who shares a workspace
with the target can read the target's profile fields but not their email.
Unrelated users receive 404. Account deletion removes owned workspaces before
deleting the user because the owner relation is intentionally restrictive;
dependent memberships, sessions, verification/reset tokens, invites, documents,
and versions then follow the schema's cascade or set-null rules.

The underlying ownership and relation constraints are shown in
[Data model](data-model.md). Realtime enforcement details are in
[Realtime collaboration](realtime-collaboration.md).
