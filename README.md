# Meridian

Meridian is a TypeScript end-to-end collaborative browser IDE for engineering teams. Engineers open a workspace in their browser, write and edit code through a Monaco-powered editor, and see each other's changes in real time — backed by Yjs CRDT convergence, Socket.IO sessions, Redis cross-instance fan-out, and PostgreSQL persistence.

---

## Features

- **Browser IDE workspace** — full IDE layout: file explorer, editor tabs, activity bar, status bar, and collapsible bottom/side panels
- **Monaco editor** — VS Code's editor engine with syntax highlighting, bracket pair colorization, and multi-language support
- **Project / document tree** — hierarchical file and folder structure per workspace, fetched from the backend on load
- **Editor tabs** — multi-file editing with dirty-state tracking and Cmd+S / Ctrl+S save to backend
- **Live collaboration** — Socket.IO document rooms with Yjs CRDT merge; concurrent edits from multiple clients converge deterministically
- **Yjs CRDT sync** — binary update protocol; the server maintains an authoritative Y.Doc per open document and performs sync step 1/2 handshakes with every joining client
- **Redis cross-instance fan-out** — Yjs updates and awareness states (cursor positions, selections) are published to Redis and relayed to clients on other server instances
- **PostgreSQL persistence** — users, workspaces, documents, and Yjs update logs persisted durably via Prisma
- **Snapshot compaction** — every N Yjs updates the in-memory Y.Doc state is saved as a Snapshot row and preceding update rows are deleted in a single transaction, bounding storage growth
- **Authentication and session management** — argon2id password hashing, JWT httpOnly cookies, per-session revocation via a `Session` table
- **Frontend resilience** — when the backend is unavailable the frontend silently falls back to a local mock workspace; no crash, no empty screen

---

## Monorepo layout

```text
Meridian/
├── client/     # React + TypeScript + Vite frontend
├── server/     # NestJS + TypeScript backend
└── docs/       # Architecture documentation
```

---

## Tech stack

### Frontend

| Library / Tool | Role |
|---|---|
| React 18 | UI component framework |
| TypeScript | Static typing end-to-end |
| Vite | Build tool and dev server |
| Tailwind CSS | Utility-first styling system |
| Zustand | Global workspace state management |
| Monaco Editor | VS Code editor engine (`@monaco-editor/react`) |
| React Router | Client-side routing |
| Yjs + y-monaco | CRDT collaborative editing bound to Monaco |
| socket.io-client | WebSocket transport |

### Backend

| Library / Tool | Role |
|---|---|
| NestJS | Server framework — modules, DI, decorators |
| TypeScript | Static typing end-to-end |
| PostgreSQL | Primary durable datastore |
| Prisma | ORM, type-safe queries, schema migrations |
| Socket.IO | WebSocket transport for realtime events |
| Yjs + y-protocols | Authoritative CRDT document state on the server |
| Redis (ioredis) | Cross-instance pub/sub fan-out |
| JWT (`@nestjs/jwt`) | Stateless auth tokens |
| argon2id | Password hashing (argon2id variant) |
| Pino (`nestjs-pino`) | Structured JSON logging |
| Swagger | Auto-generated OpenAPI documentation |

---

## Local development

### Client

```bash
cd client
npm install
npm run dev       # Dev server → http://localhost:5173
npm run build     # Production build
```

### Server

```bash
cd server
npm install
cp .env.example .env        # Set JWT_SECRET; review other values
npm run infra:up            # Start PostgreSQL + Redis via Docker Compose
npm run db:migrate          # Apply Prisma schema migrations
npm run db:seed             # Seed demo workspace and user
npm run start:dev           # Dev server with file watch → http://localhost:3000
npm test                    # Run unit test suite
npm run build               # Compile TypeScript
```

---

## Local URLs

| URL | Purpose |
|-----|---------|
| `http://localhost:5173` | Frontend workspace |
| `http://localhost:3000/health` | Backend liveness probe |
| `http://localhost:3000/ready` | Backend readiness probe (Postgres + Redis) |
| `http://localhost:3000/docs` | Swagger / OpenAPI explorer |
| `http://localhost:5555` | Prisma Studio (`npm run db:studio` in `server/`) |

---

## Architecture

See **[docs/architecture.md](docs/architecture.md)** for the full diagram set: system context, container layout, backend components, realtime editing sequence, cross-instance Redis scaling, Yjs persistence and recovery, and the complete data model.
