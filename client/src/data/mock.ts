import type { Collaborator, FileNode } from "../types";

export const mockFiles: FileNode[] = [
  {
    kind: "folder",
    id: "folder-meridian-workspace",
    name: "meridian-workspace",
    expanded: true,
    children: [
      {
        kind: "folder",
        id: "folder-src",
        name: "src",
        expanded: true,
        children: [
          {
            kind: "folder",
            id: "folder-services",
            name: "services",
            expanded: true,
            children: [
              {
                kind: "file",
                id: "file-auth",
                name: "auth.ts",
                language: "typescript",
              },
              {
                kind: "file",
                id: "file-database",
                name: "database.ts",
                language: "typescript",
              },
            ],
          },
          {
            kind: "folder",
            id: "folder-components",
            name: "components",
            expanded: false,
            children: [],
          },
        ],
      },
      {
        kind: "folder",
        id: "folder-tests",
        name: "tests",
        expanded: false,
        children: [],
      },
      {
        kind: "file",
        id: "file-package-json",
        name: "package.json",
        language: "json",
      },
      {
        kind: "file",
        id: "file-gitignore",
        name: ".gitignore",
        language: "typescript",
      },
    ],
  },
];

export const mockFileContents: Record<string, string> = {
  "file-auth": `import { createHash, timingSafeEqual } from "node:crypto";

export type AuthResult =
  | { ok: true; userId: string; sessionId: string }
  | { ok: false; reason: "invalid_credentials" | "locked" };

export async function authenticate(
  email: string,
  password: string,
): Promise<AuthResult> {
  const user = await findUserByEmail(email);
  if (!user || user.lockedUntil && user.lockedUntil > Date.now()) {
    return { ok: false, reason: "locked" };
  }

  const digest = createHash("sha256").update(password + user.salt).digest();
  const valid = timingSafeEqual(digest, user.passwordHash);
  if (!valid) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const sessionId = crypto.randomUUID();
  return { ok: true, userId: user.id, sessionId };
}
`,
  "file-database": `import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export async function connect(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

export { pool };
`,
  "file-package-json": `{
  "name": "meridian-workspace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "pg": "^8.13.1",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "typescript": "~5.7.2",
    "vitest": "^3.0.5"
  }
}
`,
};

export const mockCollaborators: Collaborator[] = [
  {
    id: "user-santino",
    name: "Santino",
    color: "#3525cd",
    status: "active",
    activity: "Editing auth.ts",
    isOwner: true,
  },
  {
    id: "user-elena",
    name: "Elena",
    color: "#059669",
    status: "active",
    activity: "Reviewing PR #42",
    isOwner: false,
  },
  {
    id: "user-marcus",
    name: "Marcus",
    color: "#d97706",
    status: "idle",
    activity: "Away — in standup",
    isOwner: false,
  },
];

