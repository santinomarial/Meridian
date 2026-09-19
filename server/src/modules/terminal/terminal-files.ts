import * as fs from 'fs/promises';
import { constants } from 'fs';
import { safeJoin, assertSafeRelPath } from './path-safety';

export const TERMINAL_FILE_MAX_BYTES = 1024 * 1024;
export const TERMINAL_TREE_MAX_FILES = 1000;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const EXCLUDED = new Set([
  '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache',
  '.next', '.nuxt', 'dist', 'build', 'coverage', 'target', '.meridian-build',
  '.terminal-sandboxes', '.bash_history', '.zsh_history', '.python_history',
]);

export interface TerminalFileChange {
  path: string;
  content: string;
  /** Last content projected into this terminal; undefined for a new file. */
  baseContent?: string;
}

export interface TerminalFileResult {
  conflictSource?: string;
  path: string;
  content: string;
}

export type TerminalFileImporter = (
  workspaceId: string,
  userId: string,
  sessionJti: string | undefined,
  changes: TerminalFileChange[],
) => Promise<TerminalFileResult[]>;

export function isTerminalSourcePath(relPath: string): boolean {
  return relPath.split('/').every((part) =>
    !EXCLUDED.has(part) && !part.startsWith('.zcompdump') &&
    !part.endsWith('.swp') && !part.endsWith('.swo') && !part.endsWith('~'),
  );
}

/** Bounded UTF-8 text scan. Never follow symlinks, hard links, or special files. */
export async function readTerminalFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  let total = 0;
  let entriesSeen = 0;
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid terminal root');
  async function visit(relDir: string, depth: number): Promise<void> {
    if (depth > 64) throw new Error('Terminal folder depth exceeds 64');
    const dir = relDir ? safeJoin(root, relDir) : root;
    // opendir streams huge directories rather than allocating every entry.
    for await (const entry of await fs.opendir(dir)) {
      if (++entriesSeen > 4000) throw new Error('Terminal file scan exceeds 4000 entries');
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (!isTerminalSourcePath(relPath)) continue;
      try {
        if (assertSafeRelPath(relPath) !== relPath || Buffer.byteLength(relPath) > 4096) continue;
      } catch { continue; }
      if (entry.isSymbolicLink()) continue;
      const target = safeJoin(root, relPath);
      if (entry.isDirectory()) { await visit(relPath, depth + 1); continue; }
      if (!entry.isFile()) continue;
      const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || before.size > TERMINAL_FILE_MAX_BYTES) continue;
        const bytes = Buffer.alloc(before.size + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const after = await handle.stat();
        if (bytesRead !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) continue;
        const data = bytes.subarray(0, bytesRead);
        if (data.includes(0)) continue;
        let content: string;
        try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); } catch { continue; }
        total += bytesRead;
        if (files.size >= TERMINAL_TREE_MAX_FILES || total > MAX_TOTAL_BYTES) {
          throw new Error('Terminal text files exceed workspace import limits');
        }
        files.set(relPath, content);
      } finally { await handle.close(); }
    }
  }
  await visit('', 0);
  return files;
}
