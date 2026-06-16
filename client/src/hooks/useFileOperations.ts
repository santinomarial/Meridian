import { useCallback, useState } from "react";
import JSZip from "jszip";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import {
  getLanguageFromFilename,
  getStarterContent,
  isSupportedTextFile,
  toLanguageMode,
} from "../lib/language";
import {
  bulkCreateDocuments,
  createDocument,
  deleteDocument,
  updateDocument,
} from "../lib/api";
import type { CreateDocumentPayload } from "../lib/apiTypes";
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
  folderIdByPath?: Map<string, string>,
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
          id: folderIdByPath?.get(nextPath) ?? generateId(),
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

function collectNodeIds(nodes: FileNode[], acc: Set<string>): void {
  for (const node of nodes) {
    acc.add(node.id);
    if (node.kind === "folder") collectNodeIds(node.children, acc);
  }
}

/** Drop nodes that already exist in the tree (re-imports reuse backend ids). */
function pruneExistingNodes(nodes: FileNode[], existingIds: Set<string>): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (existingIds.has(node.id)) continue;
    result.push(
      node.kind === "folder"
        ? { ...node, children: pruneExistingNodes(node.children, existingIds) }
        : node,
    );
  }
  return result;
}

/** Normalized path: no leading/trailing slashes or empty segments. */
function normalizePath(path: string): string {
  return path.split("/").filter(Boolean).join("/");
}

/** All ancestor folder paths needed by the given file entries, depth order. */
function collectFolderPaths(entries: FileEntry[]): string[] {
  const folderPaths = new Set<string>();
  for (const entry of entries) {
    const parts = normalizePath(entry.path).split("/");
    let current = "";
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]!}` : parts[i]!;
      folderPaths.add(current);
    }
  }
  return [...folderPaths].sort(
    (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
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

        // Sync the whole import to the backend in one bulk request, then use
        // the returned ids so the local tree matches the persisted documents.
        let folderIdByPath: Map<string, string> | undefined;
        let syncedToBackend = false;
        if (isBackendAvailable) {
          try {
            const documents: CreateDocumentPayload[] = [
              ...collectFolderPaths(entries).map((path): CreateDocumentPayload => ({
                type: "FOLDER",
                name: path.split("/").pop()!,
                path,
              })),
              ...entries.map((entry): CreateDocumentPayload => ({
                type: "FILE",
                name: entry.name,
                path: normalizePath(entry.path),
                language: entry.language,
                content: entry.content,
              })),
            ];
            const created = await bulkCreateDocuments(workspaceId!, { documents });
            const idByPath = new Map(created.map((doc) => [doc.path, doc.id]));
            folderIdByPath = idByPath;
            for (const entry of entries) {
              const backendId = idByPath.get(normalizePath(entry.path));
              if (backendId !== undefined) entry.id = backendId;
            }
            syncedToBackend = true;
          } catch {
            // Backend sync failed — import locally with generated ids.
          }
        }

        const { nodes: builtNodes, contentMap } = buildTreeFromEntries(entries, folderIdByPath);

        // Re-imports reuse backend ids; skip nodes already in the tree.
        const existingIds = new Set<string>();
        collectNodeIds(useWorkspaceStore.getState().files, existingIds);
        const nodes = pruneExistingNodes(builtNodes, existingIds);

        const firstEntry =
          entries.find((e) => e.name.toLowerCase() === "readme.md") ??
          entries.find((e) => e.name === "package.json") ??
          entries[0];

        importFiles(nodes, contentMap, firstEntry?.id ?? null);
        if (syncedToBackend) setSaveStatus("saved");

        if (skippedCount > 0) {
          const detail = firstSkipReason ? ` First skipped: ${firstSkipReason}.` : "";
          return { error: `Imported ${entries.length} file(s). Skipped ${skippedCount}.${detail}` };
        }
        return {};
      } finally {
        setIsImporting(false);
      }
    },
    [importFiles, isBackendAvailable, workspaceId, setSaveStatus],
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
