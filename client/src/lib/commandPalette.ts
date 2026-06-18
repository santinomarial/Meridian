import type { FileNode } from "../types";

/** A file flattened out of the workspace tree, with its full slash path. */
export interface FlatFile {
  id: string;
  name: string;
  /** Folder context, e.g. "src/services" — empty string for root files. */
  folder: string;
  /** Full path, e.g. "src/services/auth.ts". */
  path: string;
}

/**
 * Flattens the workspace file tree into a list of files (folders are dropped,
 * but contribute their names to each descendant's path).
 */
export function flattenFileTree(nodes: FileNode[], parentPath = ""): FlatFile[] {
  const out: FlatFile[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      const folderPath = parentPath ? `${parentPath}/${node.name}` : node.name;
      out.push(...flattenFileTree(node.children, folderPath));
    } else {
      out.push({
        id: node.id,
        name: node.name,
        folder: parentPath,
        path: parentPath ? `${parentPath}/${node.name}` : node.name,
      });
    }
  }
  return out;
}

/**
 * Ranks a file against a query. Lower is better; -1 means no match.
 * Case-insensitive substring matching, preferring name matches over path-only
 * matches and prefix matches over mid-string matches.
 */
export function scoreFile(file: FlatFile, query: string): number {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return -1;
  const name = file.name.toLowerCase();
  const path = file.path.toLowerCase();

  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (path.includes(q)) return 3;
  return -1;
}

/**
 * Returns files matching the query, best matches first. An empty query yields
 * no results (the palette only lists files once the user starts typing).
 */
export function searchFiles(
  files: FlatFile[],
  query: string,
  limit = 25,
): FlatFile[] {
  if (query.trim().length === 0) return [];
  const scored: { file: FlatFile; score: number }[] = [];
  for (const file of files) {
    const score = scoreFile(file, query);
    if (score >= 0) scored.push({ file, score });
  }
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.file.name.length - b.file.name.length ||
      a.file.path.localeCompare(b.file.path),
  );
  return scored.slice(0, limit).map((s) => s.file);
}

/**
 * Case-insensitive match of a command by its title and optional keywords.
 * An empty query matches everything (the palette shows all commands at rest).
 */
export function commandMatches(
  query: string,
  title: string,
  keywords = "",
): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return `${title} ${keywords}`.toLowerCase().includes(q);
}
