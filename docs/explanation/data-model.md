# Data model

PostgreSQL stores identity, authorization, workspace structure, saved
checkpoints, version history, and generation-aware Yjs history. Redis and
process memory hold coordination state, not additional application records.

## Identity lifecycle

```mermaid
erDiagram
    USER ||--o{ SESSION : authenticates
    USER ||--o{ PASSWORD_RESET_TOKEN : resets
    USER ||--o{ EMAIL_VERIFICATION_TOKEN : verifies

    USER {
        string id PK
        string email UK
        datetime emailVerifiedAt
        string passwordHash
        string displayName
        string avatarUrl
    }
    SESSION {
        string id PK
        string userId FK
        string jti UK
        datetime expiresAt
        datetime revokedAt
    }
    PASSWORD_RESET_TOKEN {
        string id PK
        string userId FK
        string tokenHash UK
        datetime expiresAt
        datetime usedAt
    }
    EMAIL_VERIFICATION_TOKEN {
        string id PK
        string userId FK
        string tokenHash UK
        datetime expiresAt
        datetime usedAt
    }
```

## Workspace access

```mermaid
erDiagram
    USER ||--o{ WORKSPACE : owns
    USER ||--o{ WORKSPACE_MEMBER : joins
    WORKSPACE ||--o{ WORKSPACE_MEMBER : contains
    USER ||--o{ INVITE : sends
    WORKSPACE ||--o{ INVITE : issues

    USER {
        string id PK
    }
    WORKSPACE {
        string id PK
        string ownerId FK
        string name
    }
    WORKSPACE_MEMBER {
        string id PK
        string workspaceId FK
        string userId FK
        WorkspaceRole role
    }
    INVITE {
        string id PK
        string tokenHash UK
        string workspaceId FK
        string invitedById FK
        string email
        WorkspaceRole role
        datetime expiresAt
        datetime acceptedAt
    }
```

## Documents and collaborative history

```mermaid
erDiagram
    USER o|--o{ DOCUMENT_VERSION : authors
    WORKSPACE ||--o{ DOCUMENT : contains
    WORKSPACE ||--o{ DOCUMENT_VERSION : indexes
    DOCUMENT o|--o{ DOCUMENT : parents
    DOCUMENT ||--o{ DOCUMENT_VERSION : records
    DOCUMENT ||--o{ DOCUMENT_UPDATE : appends
    DOCUMENT ||--o{ SNAPSHOT : compacts

    USER {
        string id PK
    }
    WORKSPACE {
        string id PK
    }
    DOCUMENT {
        string id PK
        string workspaceId FK
        string parentId FK
        DocumentType type
        string path
        string name
        string language
        string content
        int crdtGeneration
    }
    DOCUMENT_VERSION {
        string id PK
        string documentId FK
        string workspaceId FK
        string createdById FK
        int versionNumber
        string content
        string message
    }
    DOCUMENT_UPDATE {
        string id PK
        string documentId FK
        int generation
        int seq
        string updateId
        bytes update
    }
    SNAPSHOT {
        string id PK
        string documentId FK
        int generation
        int seq
        bytes state
    }
```

Mermaid does not express all nullability in these diagrams. Email verification
time, password hashes, and avatars can be absent; invite email and acceptance
time are optional; document parent, language, and content can be null; version
author/message, session revocation, verification/reset usage, and legacy update
IDs can also be null.

## Invariants

Membership is unique per workspace and user, and document paths are unique per
workspace. Documents form a recursive tree; root nodes have no parent, and
deleting a parent cascades to descendants.

Versions are numbered uniquely per document. Update ordering and idempotency are
scoped to a CRDT lineage:

- `(documentId, generation, seq)` is unique; and
- `(documentId, generation, updateId)` is unique.

`Document.crdtGeneration` selects the current lineage. Updates and snapshots
carry the same generation so a restore or import reset can replace history
without allowing delayed writes from the prior lineage to reappear. Sequence
numbers can restart in a new generation.

Deleting a workspace cascades through memberships, invites, documents, and
workspace-indexed versions. Deleting a document cascades through descendants,
versions, updates, and snapshots. Deleting a version author preserves history
by setting `createdById` to null. User-owned workspaces use restrictive owner
semantics and are explicitly deleted as part of account deletion before the
user row is removed. Verification and reset tokens cascade with their user.

Why the three text-bearing model families exist is explained in
[Document model and save](document-model-and-save.md). Their generation,
ordering, and compaction behavior is explained in
[Persistence, compaction, and restore](persistence-compaction-and-restore.md).
