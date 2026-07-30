# Socket.IO events

The server uses Socket.IO's default namespace and path (`/socket.io/`). The
handshake authenticates with `handshake.auth.token` first, then the
`auth_token` cookie. The JWT and its database `Session` row must be valid,
unexpired, and unrevoked.

Rooms:

| Room | Joined by | Carries |
|---|---|---|
| `workspace:<workspaceId>` | `joinWorkspace` | Workspace chat |
| `document:<documentId>` | `joinDocument` | Yjs, awareness, restore, and join/leave presence |

Active protected events recheck the session and current role, with a one-second
authorization cache. A ten-second sweep rechecks passive sockets.

## Client to server: collaboration

| Event | Payload | Room/access | Server action |
|---|---|---|---|
| `joinWorkspace` | `{ workspaceId: string }` | Any member | Join workspace room; emit `joinedWorkspace` |
| `chat:message` | `{ workspaceId: string, text: string }`; text length 1–2000 | Any member; must have joined workspace room | Build sender identity, relay to peers, publish to Redis |
| `joinDocument` | `{ documentId: string, userId?: string, displayName?: string }` | Any member of containing workspace; optional identity fields are ignored | Join/acquire document, begin Yjs sync, send awareness, emit join events |
| `leaveDocument` | `{ documentId: string }` | Existing room membership; unmetered | Remove awareness, leave/release, emit `userLeft` |
| `yjs:sync` | `{ documentId: string, message: binary }` | Any role; joined document room | Read-only Yjs sync: accept SyncStep1, ignore SyncStep2, reject mutating messages |
| `yjs:update` | `{ documentId: string, updateId: string, update: binary }`; ID length 8–128 | Owner/editor; joined document room | Apply, relay, persist, then emit custom ack/nack |
| `awareness:update` | `{ documentId: string, update: binary }` | Any role; joined document room | Replace asserted user identity, relay ephemeral awareness, publish to Redis |

`yjs:sync`, `yjs:update`, and `awareness:update` are capped by
`WS_MAX_YJS_UPDATE_BYTES`. Every event above except `leaveDocument` uses the
editor gateway's per-socket one-second budget.

## Server to client: collaboration

| Event | Payload | Recipients |
|---|---|---|
| `joinedWorkspace` | `{ workspaceId }` | Joining socket |
| `joinedDocument` | `{ documentId, socketId, generation }` | Joining socket |
| `userJoined` | `{ documentId, socketId, userId, displayName }` | Existing peers in document room |
| `userLeft` | `{ documentId, socketId }` | Remaining document-room sockets |
| `chat:message` | `{ id, workspaceId, senderId, senderName, text, timestamp }` | Workspace peers, excluding local sender; all sockets on remote replicas |
| `yjs:sync` | `{ documentId, message: binary }` | Joining/requesting socket |
| `yjs:update` | `{ documentId, update: binary }` | Document peers; Redis fan-out may include every local room socket |
| `awareness:update` | `{ documentId, update: binary }` | Joining socket for current state, then document peers |
| `document:restored` | `{ documentId, generation }` | Document room or stale update sender |
| `error` | `{ message: string }` | Offending socket |

### Durable update ack/nack

These are application events, not Socket.IO acknowledgement callbacks.

| Event | Payload | Meaning |
|---|---|---|
| `yjs:ack` | `{ documentId, updateId, generation, seq }` | PostgreSQL commit completed; the same `updateId` is idempotent |
| `yjs:nack` | `{ documentId, updateId, reason: "persist_failed" }` | Persistence failed; retain and resend the queued update |

A stale generation emits `document:restored`, not `yjs:nack`.

## Client to server: terminal

Terminal events use a separate per-socket rate-limit namespace. The feature
must be enabled, and use requires owner/editor membership.

| Event | Payload | Metered | Action |
|---|---|:---:|---|
| `terminal:start` | `{ workspaceId: non-empty string }` | Yes | Materialize saved files and start/reuse one PTY for the socket |
| `terminal:run-file` | `{ workspaceId, documentId }` | Yes | Start PTY if needed and run a workspace file |
| `terminal:input` | `{ data: string }`, at most 16,384 UTF-16 code units | Yes | Write raw input to active PTY |
| `terminal:resize` | `{ cols: 1..500, rows: 1..200 }` integers | Yes | Resize active PTY |
| `terminal:stop` | no payload | No | Kill active PTY and emit `terminal:exit` |

Run-file extensions:

| Extension | Command |
|---|---|
| `.py` | `python3 <path>` |
| `.js` | `node <path>` |
| `.ts` | `npx --no-install tsx <path>` |
| `.sh` | `bash <path>` |
| `.go` | `go run <path>` |

## Server to client: terminal

| Event | Payload |
|---|---|
| `terminal:status` | `{ status: "ready" | "running" }` |
| `terminal:output` | `{ data: string }` |
| `terminal:error` | `{ message: string }` |
| `terminal:exit` | `{ code: number | null }` |
| `terminal:sync` | `{ status: "synced" | "failed" }` |

The PTY has a 30-minute idle timeout and four-hour absolute lifetime. Timeout
messages arrive through `terminal:output`, followed by `terminal:exit`.

## Redis coordination

`REDIS_KEY_PREFIX` is prepended to every channel/key below.

| Pattern or key | Payload/use | Subscriber |
|---|---|---|
| `document:<id>:updates` | `{ originId, documentId, generation, seq, updateId, update: base64 }` | Editor gateway; applies committed update and catches sequence gaps up from PostgreSQL |
| `document:<id>:awareness` | `{ originId, documentId, update: base64 }` | Editor gateway; ephemeral relay |
| `workspace:<id>:chat` | `{ originId, workspaceId, message }` | Editor gateway; ephemeral relay |
| `document:<id>:restore` | `{ originId, documentId, generation }` | Restore service; reload and emit `document:restored` |
| `realtime:authorization:invalidate` | `{ originId, invalidation }`; invalidation is `{ type: "session", jti }`, `{ type: "user", userId }`, or `{ type: "workspace", workspaceId, userId }` | Realtime authorization service |
| `meridian:sandbox:<workspaceId>:sync` | `{ originId, op, workspaceId, relPath?/content?/oldPath?/newPath? }`; op is write/mkdir/delete/rename | Terminal sandbox service |
| `meridian:doc:<documentId>:gen:<generation>:seq` | Integer sequence accelerator | Document persistence service |

Redis pub/sub has no replay. Update messages are post-commit and sequence-gap
repair uses PostgreSQL; awareness, chat, authorization fast-path, and sandbox
operations remain best effort.

## Bundled-client consumption

The browser client emits every client event listed above as needed. It installs
listeners for `yjs:sync`, `yjs:update`, `yjs:ack`, `awareness:update`,
`chat:message`, `document:restored`, and all five terminal server events.

The bundled browser currently does **not** consume these emitted application
events:

- `joinedWorkspace`
- `userJoined`
- `userLeft`
- `error`
- `yjs:nack` (the load harness consumes it; the browser queue remains pending
  until reconnect/resend)

It consumes `joinedDocument` only as the signal to flush/resend pending document
updates. It also listens to Socket.IO transport lifecycle events `connect`,
`disconnect`, `connect_error`, and manager `reconnect_attempt`.

For protocol lifecycle and failure behavior, see
[realtime collaboration](../../explanation/realtime-collaboration.md),
[persistence/restore](../../explanation/persistence-compaction-and-restore.md),
[terminal execution](../../explanation/terminal-execution.md), and the
[scaling/failure model](../../explanation/scaling-and-failure-model.md).
