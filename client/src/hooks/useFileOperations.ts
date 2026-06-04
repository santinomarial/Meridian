import { useCallback, useState } from "react";
import JSZip from "jszip";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import {
  getLanguageFromFilename,
  getStarterContent,
  isSupportedTextFile,
  toLanguageMode,
} from "../lib/language";
import { createDocument } from "../lib/api";
import type { FileNode, LanguageMode } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB per file
const MAX_ZIP_BYTES = 100 * 1024 * 1024; // 100 MB ZIP total

const IGNORED_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "__pycache__",
  ".cache",
  ".turbo",
  ".yarn",
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `local-${crypto.randomUUID()}`;
}

interface FileEntry {
  id: string;
  path: string;
  name: string;
  language: LanguageMode;
  content: string;
}

/** Build a FileNode tree from a flat list of path-keyed file entries. */
function buildTreeFromEntries(
  entries: FileEntry[],
): { nodes: FileNode[]; contentMap: Record<string, string> } {
  const contentMap: Record<string, string> = {};
  for (const e of entries) contentMap[e.id] = e.content;

  const root: FileNode[] = [];
  // Maps a folder path (e.g. "src/components") → its mutable children array.
  // Mutating the children array is safe here because we own these objects.
  const folderChildren = new Map<string, FileNode[]>();
  folderChildren.set("", root);

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    // The last segment is the file name; everything before is folder segments.
    let parentChildren = root;
    let currentPath = "";

    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]!;
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;

      if (!folderChildren.has(nextPath)) {
        const children: FileNode[] = [];
        folderChildren.set(nextPath, children);
        const folder: FileNode = {
          kind: "folder",
          id: generateId(),
          name: segment,
          children,
          expanded: i < 2,
        };
        parentChildren.push(folder);
      }

      parentChildren = folderChildren.get(nextPath)!;
      currentPath = nextPath;
    }

    parentChildren.push({
      kind: "file",
      id: entry.id,
      name: entry.name,
      language: entry.language,
    });
  }

  return { nodes: root, contentMap };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type FileOpResult = { error?: string };

export function useFileOperations() {
  const [isImporting, setIsImporting] = useState(false);

  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const addFileNode = useWorkspaceStore((s) => s.addFileNode);
  const importFiles = useWorkspaceStore((s) => s.importFiles);

  // ── Create new file ────────────────────────────────────────────────────────
  const createFile = useCallback(
    async (filename: string): Promise<FileOpResult> => {
      const trimmed = filename.trim();
      if (!trimmed) return { error: "File name cannot be empty." };
      if (!isSupportedTextFile(trimmed)) {
        const ext = trimmed.split(".").pop() ?? "";
        return { error: `Unsupported file type: .${ext}` };
      }

      const language = toLanguageMode(getLanguageFromFilename(trimmed));
      const content = getStarterContent(trimmed);

      let fileId = generateId();

      if (backendStatus === "available" && workspaceId !== null) {
        try {
          const doc = await createDocument(workspaceId, {
            type: "FILE",
            name: trimmed,
            path: trimmed,
            language,
            content,
          });
          fileId = doc.id;
        } catch {
          // Backend unavailable or request failed — keep local id.
        }
      }

      addFileNode({ kind: "file", id: fileId, name: trimmed, language }, content);
      return {};
    },
    [workspaceId, backendStatus, addFileNode],
  );

  // ── Open local file from disk ──────────────────────────────────────────────
  const openLocalFile = useCallback(
    async (file: File): Promise<FileOpResult> => {
      if (!isSupportedTextFile(file.name)) {
        const ext = file.name.split(".").pop() ?? "";
        return { error: `Unsupported file type: .${ext}` };
      }
      if (file.size > MAX_FILE_BYTES) {
        return { error: `File too large: ${file.name} (max 1 MB).` };
      }

      let content: string;
      try {
        content = await file.text();
      } catch {
        return { error: `Could not read file: ${file.name}.` };
      }

      const language = toLanguageMode(getLanguageFromFilename(file.name));
      let fileId = generateId();

      if (backendStatus === "available" && workspaceId !== null) {
        try {
          const doc = await createDocument(workspaceId, {
            type: "FILE",
            name: file.name,
            path: file.name,
            language,
            content,
          });
          fileId = doc.id;
        } catch {
          // Keep local id on backend failure.
        }
      }

      addFileNode({ kind: "file", id: fileId, name: file.name, language }, content);
      return {};
    },
    [workspaceId, backendStatus, addFileNode],
  );

  // ── Import ZIP ─────────────────────────────────────────────────────────────
  const importZip = useCallback(
    async (file: File): Promise<FileOpResult> => {
      if (file.size > MAX_ZIP_BYTES) {
        return { error: "ZIP file is too large (max 100 MB)." };
      }

      setIsImporting(true);
      try {
        let zip: JSZip;
        try {
          zip = await new JSZip().loadAsync(file);
        } catch {
          return { error: "Could not read ZIP file. Is it a valid ZIP archive?" };
        }

        const entries: FileEntry[] = [];

        await Promise.all(
          Object.entries(zip.files).map(async ([path, entry]) => {
            if (entry.dir) return;

            // Skip files inside ignored directories.
            const segments = path.split("/");
            if (segments.some((s) => IGNORED_DIR_SEGMENTS.has(s))) return;

            const fileName = segments[segments.length - 1] ?? "";
            if (!fileName || !isSupportedTextFile(fileName)) return;

            let content: string;
            try {
              content = await entry.async("string");
            } catch {
              return; // Skip unreadable / binary files.
            }
            if (content.length > MAX_FILE_BYTES) return;

            entries.push({
              id: generateId(),
              path,
              name: fileName,
              language: toLanguageMode(getLanguageFromFilename(fileName)),
              content,
            });
          }),
        );

        if (entries.length === 0) {
          return { error: "No supported text files found in ZIP." };
        }

        // Stable order: alphabetical by path.
        entries.sort((a, b) => a.path.localeCompare(b.path));

        const { nodes, contentMap } = buildTreeFromEntries(entries);

        // Choose the first file to open: README.md → package.json → first file.
        const firstEntry =
          entries.find((e) => e.name.toLowerCase() === "readme.md") ??
          entries.find((e) => e.name === "package.json") ??
          entries[0];

        importFiles(nodes, contentMap, firstEntry?.id ?? null);
        return {};
      } finally {
        setIsImporting(false);
      }
    },
    [importFiles],
  );

  return { createFile, openLocalFile, importZip, isImporting };
}
