import { PrismaClient, DocumentType, WorkspaceRole } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// File contents
// ---------------------------------------------------------------------------

const CONTENTS: Record<string, string> = {
  'src/services/auth.ts': `\
import { sign, verify } from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
  iat: number;
  exp: number;
}

const SECRET = process.env.JWT_SECRET ?? '';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '15m';

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return verify(token, SECRET) as JwtPayload;
}
`,

  'src/services/editorSync.ts': `\
import * as Y from 'yjs';

export type ClientId = string;

const docs = new Map<string, Y.Doc>();

export function getOrCreateDoc(documentId: string): Y.Doc {
  let doc = docs.get(documentId);
  if (!doc) {
    doc = new Y.Doc();
    docs.set(documentId, doc);
  }
  return doc;
}

export function applyUpdate(documentId: string, update: Uint8Array): void {
  const doc = getOrCreateDoc(documentId);
  Y.applyUpdate(doc, update);
}

export function encodeStateAsUpdate(documentId: string): Uint8Array {
  return Y.encodeStateAsUpdate(getOrCreateDoc(documentId));
}

export function destroyDoc(documentId: string): void {
  docs.get(documentId)?.destroy();
  docs.delete(documentId);
}
`,

  'src/hooks/useWorkspace.ts': `\
import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';

export interface UseWorkspaceReturn {
  workspaceId: string | null;
  documents: unknown[];
  isLoading: boolean;
  error: string | null;
}

export function useWorkspace(workspaceId: string): UseWorkspaceReturn {
  const { documents, isLoading, error, fetchDocuments } = useWorkspaceStore();

  useEffect(() => {
    void fetchDocuments(workspaceId);
  }, [workspaceId, fetchDocuments]);

  return { workspaceId, documents, isLoading, error };
}
`,

  'src/components/WorkspaceLayout.tsx': `\
import React from 'react';
import { useWorkspace } from '../hooks/useWorkspace';

interface WorkspaceLayoutProps {
  workspaceId: string;
  children: React.ReactNode;
}

export function WorkspaceLayout({
  workspaceId,
  children,
}: WorkspaceLayoutProps) {
  const { isLoading, error } = useWorkspace(workspaceId);

  if (isLoading) {
    return <div className="workspace-loading">Loading workspace…</div>;
  }

  if (error) {
    return <div className="workspace-error">{error}</div>;
  }

  return (
    <div className="workspace-layout">
      <aside className="workspace-sidebar" />
      <main className="workspace-main">{children}</main>
    </div>
  );
}
`,

  'src/index.css': `\
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --color-bg: #0d1117;
  --color-surface: #161b22;
  --color-border: #30363d;
  --color-text: #e6edf3;
  --color-text-muted: #8b949e;
  --color-accent: #58a6ff;
  --sidebar-width: 240px;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-mono);
  height: 100dvh;
  overflow: hidden;
}

.workspace-layout {
  display: flex;
  height: 100dvh;
}

.workspace-sidebar {
  width: var(--sidebar-width);
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  flex-shrink: 0;
  overflow-y: auto;
}

.workspace-main {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workspace-loading,
.workspace-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  color: var(--color-text-muted);
  font-size: 0.875rem;
}
`,

  'package.json': `\
{
  "name": "meridian",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["client", "server"],
  "scripts": {
    "dev": "concurrently \\"npm run dev -w client\\" \\"npm run start:dev -w server\\"",
    "build": "npm run build -w client && npm run build -w server"
  },
  "devDependencies": {
    "concurrently": "^9"
  }
}
`,

  'README.md': `\
# Meridian

A real-time collaborative browser IDE built on Monaco Editor, Yjs, and NestJS.

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, Monaco Editor, Zustand |
| Backend | NestJS 11, Socket.IO, Yjs |
| Database | PostgreSQL (Prisma ORM) |
| Cache / Pub-Sub | Redis (ioredis) |
| Auth | JWT + argon2 |

## Quick start

\`\`\`bash
cd server
cp .env.example .env
npm run infra:up
npm run db:migrate
npm run start:dev
\`\`\`
`,

  'worker.py': `\
"""Background worker: compacts Yjs document update logs."""
from __future__ import annotations

import os
import time
import logging
import psycopg2

logger = logging.getLogger(__name__)
DATABASE_URL = os.environ["DATABASE_URL"]

COMPACTION_THRESHOLD = int(os.getenv("COMPACTION_THRESHOLD", "100"))
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))


def compact_document(conn, document_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) FROM document_updates
            WHERE document_id = %s
            """,
            (document_id,),
        )
        row = cur.fetchone()
        count = row[0] if row else 0
        if count < COMPACTION_THRESHOLD:
            return
        logger.info("Compacting %s (%d updates)", document_id, count)
        # Merge logic: apply all updates, write snapshot, truncate updates.
        cur.execute(
            "DELETE FROM document_updates WHERE document_id = %s",
            (document_id,),
        )
    conn.commit()


def run() -> None:
    logging.basicConfig(level=logging.INFO)
    conn = psycopg2.connect(DATABASE_URL)
    logger.info("Worker started, poll interval %ds", POLL_INTERVAL)
    while True:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT DISTINCT document_id FROM document_updates")
                ids = [r[0] for r in cur.fetchall()]
            for doc_id in ids:
                compact_document(conn, doc_id)
        except Exception:
            logger.exception("Compaction error")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()
`,

  'sync.go': `\
// Package main provides a lightweight Yjs update relay over WebSocket.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type room struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]struct{}
}

var (
	roomsMu sync.RWMutex
	rooms   = map[string]*room{}
)

func getRoom(id string) *room {
	roomsMu.Lock()
	defer roomsMu.Unlock()
	if r, ok := rooms[id]; ok {
		return r
	}
	r := &room{clients: map[*websocket.Conn]struct{}{}}
	rooms[id] = r
	return r
}

type message struct {
	DocumentID string \`json:"documentId"\`
	Update     []byte \`json:"update"\`
}

func handle(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var rm *room
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		var msg message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if rm == nil {
			rm = getRoom(msg.DocumentID)
			rm.mu.Lock()
			rm.clients[conn] = struct{}{}
			rm.mu.Unlock()
		}
		rm.mu.RLock()
		for c := range rm.clients {
			if c != conn {
				_ = c.WriteMessage(websocket.BinaryMessage, msg.Update)
			}
		}
		rm.mu.RUnlock()
	}

	if rm != nil {
		rm.mu.Lock()
		delete(rm.clients, conn)
		rm.mu.Unlock()
	}
}

func main() {
	addr := os.Getenv("SYNC_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	http.HandleFunc("/sync", handle)
	log.Printf("sync relay listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
`,

  'parser.rs': `\
//! Minimal Rust parser for Meridian document path tokens.

#[derive(Debug, PartialEq)]
pub enum Token {
    Segment(String),
    Separator,
}

pub fn tokenize(path: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    for part in path.split('/') {
        if !tokens.is_empty() {
            tokens.push(Token::Separator);
        }
        if !part.is_empty() {
            tokens.push(Token::Segment(part.to_owned()));
        }
    }
    tokens
}

pub fn normalize(path: &str) -> String {
    tokenize(path)
        .into_iter()
        .filter_map(|t| match t {
            Token::Segment(s) => Some(s),
            Token::Separator => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize() {
        let tokens = tokenize("src/services/auth.ts");
        assert_eq!(tokens.len(), 5);
    }

    #[test]
    fn test_normalize() {
        assert_eq!(normalize("//src//auth.ts//"), "src/auth.ts");
    }
}
`,
};

// ---------------------------------------------------------------------------
// Document tree definition
// ---------------------------------------------------------------------------

type DocDef = {
  path: string;
  name: string;
  type: DocumentType;
  language?: string;
  parentPath?: string;
};

const DOC_TREE: DocDef[] = [
  // top-level folders
  { path: 'client', name: 'client', type: DocumentType.FOLDER },
  { path: 'server', name: 'server', type: DocumentType.FOLDER },
  { path: 'src', name: 'src', type: DocumentType.FOLDER },
  // top-level files
  { path: 'package.json', name: 'package.json', type: DocumentType.FILE, language: 'json' },
  { path: 'README.md', name: 'README.md', type: DocumentType.FILE, language: 'markdown' },
  { path: 'worker.py', name: 'worker.py', type: DocumentType.FILE, language: 'python' },
  { path: 'sync.go', name: 'sync.go', type: DocumentType.FILE, language: 'go' },
  { path: 'parser.rs', name: 'parser.rs', type: DocumentType.FILE, language: 'rust' },
  // src/ sub-folders
  { path: 'src/services', name: 'services', type: DocumentType.FOLDER, parentPath: 'src' },
  { path: 'src/hooks', name: 'hooks', type: DocumentType.FOLDER, parentPath: 'src' },
  { path: 'src/components', name: 'components', type: DocumentType.FOLDER, parentPath: 'src' },
  // src/ file
  { path: 'src/index.css', name: 'index.css', type: DocumentType.FILE, language: 'css', parentPath: 'src' },
  // src/services/ files
  { path: 'src/services/auth.ts', name: 'auth.ts', type: DocumentType.FILE, language: 'typescript', parentPath: 'src/services' },
  { path: 'src/services/editorSync.ts', name: 'editorSync.ts', type: DocumentType.FILE, language: 'typescript', parentPath: 'src/services' },
  // src/hooks/ files
  { path: 'src/hooks/useWorkspace.ts', name: 'useWorkspace.ts', type: DocumentType.FILE, language: 'typescript', parentPath: 'src/hooks' },
  // src/components/ files
  { path: 'src/components/WorkspaceLayout.tsx', name: 'WorkspaceLayout.tsx', type: DocumentType.FILE, language: 'typescriptreact', parentPath: 'src/components' },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Seeding…');

  // --- Users ------------------------------------------------------------------

  const alice = await prisma.user.upsert({
    where: { email: 'alice@meridian.dev' },
    update: {},
    create: {
      email: 'alice@meridian.dev',
      displayName: 'Alice Chen',
      // passwordHash intentionally null until the auth module is wired in.
      // All seed users share the dev password 'password' once argon2 hashing is added.
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@meridian.dev' },
    update: {},
    create: { email: 'bob@meridian.dev', displayName: 'Bob Martinez' },
  });

  const carol = await prisma.user.upsert({
    where: { email: 'carol@meridian.dev' },
    update: {},
    create: { email: 'carol@meridian.dev', displayName: 'Carol Williams' },
  });

  const dave = await prisma.user.upsert({
    where: { email: 'dave@meridian.dev' },
    update: {},
    create: { email: 'dave@meridian.dev', displayName: 'Dave Park' },
  });

  console.log(`  users: ${[alice, bob, carol, dave].map((u) => u.email).join(', ')}`);

  // --- Workspace --------------------------------------------------------------

  let workspace = await prisma.workspace.findFirst({
    where: { name: 'Meridian', ownerId: alice.id },
  });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: { name: 'Meridian', ownerId: alice.id },
    });
  }
  console.log(`  workspace: ${workspace.name} (${workspace.id})`);

  // --- Workspace members ------------------------------------------------------

  const memberDefs: Array<{ userId: string; role: WorkspaceRole }> = [
    { userId: alice.id, role: WorkspaceRole.OWNER },
    { userId: bob.id, role: WorkspaceRole.EDITOR },
    { userId: carol.id, role: WorkspaceRole.EDITOR },
    { userId: dave.id, role: WorkspaceRole.VIEWER },
  ];

  for (const { userId, role } of memberDefs) {
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
      update: { role },
      create: { workspaceId: workspace.id, userId, role },
    });
  }
  console.log(`  members: ${memberDefs.length}`);

  // --- Documents --------------------------------------------------------------

  // Build path → id map for parent resolution, processing in tree order.
  const pathToId = new Map<string, string>();

  for (const def of DOC_TREE) {
    const parentId = def.parentPath ? pathToId.get(def.parentPath) : undefined;
    const content = def.type === DocumentType.FILE ? (CONTENTS[def.path] ?? null) : null;

    const doc = await prisma.document.upsert({
      where: { workspaceId_path: { workspaceId: workspace.id, path: def.path } },
      update: { name: def.name, language: def.language ?? null, content },
      create: {
        workspaceId: workspace.id,
        parentId: parentId ?? null,
        type: def.type,
        path: def.path,
        name: def.name,
        language: def.language ?? null,
        content,
      },
    });

    pathToId.set(def.path, doc.id);
  }

  console.log(`  documents: ${DOC_TREE.length}`);

  // --- Snapshots for key source files -----------------------------------------

  const snapshotTargets = [
    'src/services/auth.ts',
    'src/services/editorSync.ts',
    'src/components/WorkspaceLayout.tsx',
  ];

  for (const path of snapshotTargets) {
    const docId = pathToId.get(path);
    if (!docId) continue;
    const content = CONTENTS[path] ?? '';
    const exists = await prisma.snapshot.findFirst({ where: { documentId: docId, seq: 0 } });
    if (!exists) {
      await prisma.snapshot.create({
        data: {
          documentId: docId,
          state: Buffer.from(content, 'utf8'),
          seq: 0,
        },
      });
    }
  }

  console.log(`  snapshots: ${snapshotTargets.length}`);
  console.log('Done.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
