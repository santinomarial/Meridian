import { useCallback, useState } from "react";
import JSZip from "jszip";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import {
  getLanguageFromFilename,
  getStarterContent,
  isSupportedTextFile,
  toLanguageMode,
} from "../lib/language";
import { createDocument, deleteDocument, updateDocument } from "../lib/api";
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
  ".venv",
  "target",
  "vendor",
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
  const folderChildren = new Map<string, FileNode[]>();
  folderChildren.set("", root);

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
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
  const addFolderNode = useWorkspaceStore((s) => s.addFolderNode);
  const importFiles = useWorkspaceStore((s) => s.importFiles);
  const deleteNode = useWorkspaceStore((s) => s.deleteNode);
  const renameNode = useWorkspaceStore((s) => s.renameNode);
  const clearTabDirty = useWorkspaceStore((s) => s.clearTabDirty);
  const setSaveStatus = useWorkspaceStore((s) => s.setSaveStatus);

  const isBackendAvailable = backendStatus === "available" && workspaceId !== null;

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
      let savedToBackend = false;

      if (isBackendAvailable) {
        try {
          const doc = await createDocument(workspaceId!, {
            type: "FILE",
            name: trimmed,
            path: trimmed,
            language,
            content,
          });
          fileId = doc.id;
          savedToBackend = true;
        } catch {
          // Backend failed — keep local id.
        }
      }

      addFileNode({ kind: "file", id: fileId, name: trimmed, language }, content);
      if (savedToBackend) {
        clearTabDirty(fileId);
        setSaveStatus("saved");
      }
      return {};
    },
    [workspaceId, isBackendAvailable, addFileNode, clearTabDirty, setSaveStatus],
  );

  // ── Create new folder ──────────────────────────────────────────────────────
  const createFolder = useCallback(
    async (name: string): Promise<FileOpResult> => {
      const trimmed = name.trim();
      if (!trimmed) return { error: "Folder name cannot be empty." };
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return { error: "Folder name cannot contain path separators." };
      }

      let folderId = generateId();

      if (isBackendAvailable) {
        try {
          const doc = await createDocument(workspaceId!, {
            type: "FOLDER",
            name: trimmed,
            path: trimmed,
          });
          folderId = doc.id;
        } catch {
          // Backend failed — keep local id.
        }
      }

      addFolderNode({ kind: "folder", id: folderId, name: trimmed, children: [], expanded: true });
      return {};
    },
    [workspaceId, isBackendAvailable, addFolderNode],
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
      let savedToBackend = false;

      if (isBackendAvailable) {
        try {
          const doc = await createDocument(workspaceId!, {
            type: "FILE",
            name: file.name,
            path: file.name,
            language,
            content,
          });
          fileId = doc.id;
          savedToBackend = true;
        } catch {
          // Keep local id on backend failure.
        }
      }

      addFileNode({ kind: "file", id: fileId, name: file.name, language }, content);
      if (savedToBackend) {
        clearTabDirty(fileId);
        setSaveStatus("saved");
      }
      return {};
    },
    [workspaceId, isBackendAvailable, addFileNode, clearTabDirty, setSaveStatus],
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
        let skippedCount = 0;
        let firstSkipReason: string | undefined;

        await Promise.all(
          Object.entries(zip.files).map(async ([path, entry]) => {
            if (entry.dir) return;

            const segments = path.split("/");

            // Skip .DS_Store and hidden OS files
            const fileName = segments[segments.length - 1] ?? "";
            if (!fileName || fileName === ".DS_Store") return;

            if (segments.some((s) => IGNORED_DIR_SEGMENTS.has(s))) {
              skippedCount++;
              firstSkipReason ??= `${fileName} (ignored directory)`;
              return;
            }

            if (!isSupportedTextFile(fileName)) {
              skippedCount++;
              firstSkipReason ??= `${fileName} (unsupported type)`;
              return;
            }

            let content: string;
            try {
              content = await entry.async("string");
            } catch {
              skippedCount++;
              firstSkipReason ??= `${fileName} (binary/unreadable)`;
              return;
            }
            if (content.length > MAX_FILE_BYTES) {
              skippedCount++;
              firstSkipReason ??= `${fileName} (>1 MB)`;
              return;
            }

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
          const detail = firstSkipReason ? ` First skipped: ${firstSkipReason}.` : "";
          return { error: `No supported text files found in ZIP.${detail}` };
        }

        entries.sort((a, b) => a.path.localeCompare(b.path));
        const { nodes, contentMap } = buildTreeFromEntries(entries);

        const firstEntry =
          entries.find((e) => e.name.toLowerCase() === "readme.md") ??
          entries.find((e) => e.name === "package.json") ??
          entries[0];

        importFiles(nodes, contentMap, firstEntry?.id ?? null);

        if (skippedCount > 0) {
          const detail = firstSkipReason ? ` First skipped: ${firstSkipReason}.` : "";
          return { error: `Imported ${entries.length} file(s). Skipped ${skippedCount}.${detail}` };
        }
        return {};
      } finally {
        setIsImporting(false);
      }
    },
    [importFiles],
  );

  // ── Rename file or folder ──────────────────────────────────────────────────
  const renameItem = useCallback(
    async (nodeId: string, newName: string): Promise<FileOpResult> => {
      const trimmed = newName.trim();
      if (!trimmed) return { error: "Name cannot be empty." };

      // Optimistic local rename first — feels instant.
      renameNode(nodeId, trimmed);

      if (isBackendAvailable && !nodeId.startsWith("local-")) {
        try {
          await updateDocument(nodeId, { name: trimmed, path: trimmed });
        } catch {
          // Backend rename failed — local state already updated; don't revert
          // to avoid a jarring flip. Return a non-blocking warning.
          return { error: `Renamed locally. Could not sync rename to backend.` };
        }
      }

      return {};
    },
    [isBackendAvailable, renameNode],
  );

  // ── Delete file or folder ──────────────────────────────────────────────────
  const deleteItem = useCallback(
    async (nodeId: string): Promise<FileOpResult> => {
      // Remove from local state immediately.
      deleteNode(nodeId);

      if (isBackendAvailable && !nodeId.startsWith("local-")) {
        try {
          await deleteDocument(nodeId);
        } catch {
          // Backend delete failed — tree is already updated locally; warn softly.
          return { error: "Deleted locally. Could not sync delete to backend." };
        }
      }

      return {};
    },
    [isBackendAvailable, deleteNode],
  );

  return { createFile, createFolder, openLocalFile, importZip, renameItem, deleteItem, isImporting };
}
