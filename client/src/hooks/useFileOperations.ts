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
const MAX_IMPORTED_BYTES = 25 * 1024 * 1024; // 25 MB after decompression
const MAX_IMPORTED_FILES = 1_000;
const MAX_IMPORTED_DOCUMENTS = 2_000;
const MAX_BULK_REQUEST_BYTES = 26 * 1024 * 1024;
const MAX_PATH_BYTES = 4_096;
const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_DEPTH = 64;

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

/** Normalized path: no leading/trailing slashes or empty segments. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

export function isImportPathSafe(path: string): boolean {
  const slashPath = path.replace(/\\/g, "/");
  if (
    slashPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(slashPath) ||
    /[\u0000-\u001f\u007f]/.test(slashPath)
  ) {
    return false;
  }
  const normalized = normalizePath(path);
  const segments = slashPath.split("/").filter(Boolean);
  const encoder = new TextEncoder();
  return (
    normalized.length > 0 &&
    encoder.encode(normalized).byteLength <= MAX_PATH_BYTES &&
    segments.length <= MAX_PATH_DEPTH &&
    segments.every(
      (segment) =>
        segment !== "." &&
        segment !== ".." &&
        encoder.encode(segment).byteLength <= MAX_SEGMENT_BYTES,
    )
  );
}

export function declaredUncompressedSize(entry: JSZip.JSZipObject): number | null {
  const internal = entry as JSZip.JSZipObject & {
    _data?: { uncompressedSize?: unknown };
  };
  const value = internal._data?.uncompressedSize;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function findNodePath(
  nodes: FileNode[],
  nodeId: string,
  parentPath = "",
): { node: FileNode; path: string; parentPath: string } | null {
  for (const node of nodes) {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.id === nodeId) return { node, path, parentPath };
    if (node.kind === "folder") {
      const found = findNodePath(node.children, nodeId, path);
      if (found !== null) return found;
    }
  }
  return null;
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
      if (!isImportPathSafe(trimmed)) {
        return { error: "File path is invalid or too long." };
      }

      const path = normalizePath(trimmed);
      const name = path.split("/").pop()!;
      if (!isSupportedTextFile(name)) {
        const ext = name.split(".").pop() ?? "";
        return { error: `Unsupported file type: .${ext}` };
      }

      const language = toLanguageMode(getLanguageFromFilename(name));
      const content = getStarterContent(name);
      let fileId = generateId();
      let savedToBackend = false;

      if (isBackendAvailable) {
        try {
          if (path.includes("/")) {
            const folderPaths = collectFolderPaths([
              { id: fileId, path, name, language, content },
            ]);
            const created = await bulkCreateDocuments(workspaceId!, {
              documents: [
                ...folderPaths.map((folderPath): CreateDocumentPayload => ({
                  type: "FOLDER",
                  name: folderPath.split("/").pop()!,
                  path: folderPath,
                })),
                { type: "FILE", name, path, language, content },
              ],
            });
            fileId = created.find((doc) => doc.path === path)?.id ?? fileId;

            const entry: FileEntry = { id: fileId, path, name, language, content };
            const folderIds = new Map(created.map((doc) => [doc.path, doc.id]));
            const { nodes, contentMap } = buildTreeFromEntries([entry], folderIds);
            importFiles(nodes, contentMap, fileId);
          } else {
            const doc = await createDocument(workspaceId!, {
              type: "FILE",
              name,
              path,
              language,
              content,
            });
            fileId = doc.id;
            addFileNode({ kind: "file", id: fileId, name, language }, content);
          }
          savedToBackend = true;
        } catch {
          return { error: "Could not create the file. Please try again." };
        }
      } else if (path.includes("/")) {
        const entry: FileEntry = { id: fileId, path, name, language, content };
        const { nodes, contentMap } = buildTreeFromEntries([entry]);
        importFiles(nodes, contentMap, fileId);
      } else {
        addFileNode({ kind: "file", id: fileId, name, language }, content);
      }

      if (savedToBackend) {
        clearTabDirty(fileId);
        setSaveStatus("saved");
      }
      return {};
    },
    [
      workspaceId,
      isBackendAvailable,
      addFileNode,
      importFiles,
      clearTabDirty,
      setSaveStatus,
    ],
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
          return { error: "Could not create the folder. Please try again." };
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
          return { error: `Could not import ${file.name}. Please try again.` };
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
        let importedBytes = 0;
        const zipEntries = Object.entries(zip.files);
        if (zipEntries.length > MAX_IMPORTED_FILES * 2) {
          return { error: `ZIP contains too many entries (max ${MAX_IMPORTED_FILES} files).` };
        }

        for (const [path, entry] of zipEntries) {
          if (entry.dir) continue;

          const normalizedPath = normalizePath(path);
          const segments = normalizedPath.split("/");

          // Skip .DS_Store and hidden OS files
          const fileName = segments[segments.length - 1] ?? "";
          if (!fileName || fileName === ".DS_Store") continue;

          if (!isImportPathSafe(path)) {
            skippedCount++;
            firstSkipReason ??= `${fileName} (invalid or overly deep path)`;
            continue;
          }

          if (segments.some((s) => IGNORED_DIR_SEGMENTS.has(s))) {
            skippedCount++;
            firstSkipReason ??= `${fileName} (ignored directory)`;
            continue;
          }

          if (!isSupportedTextFile(fileName)) {
            skippedCount++;
            firstSkipReason ??= `${fileName} (unsupported type)`;
            continue;
          }

          const declaredBytes = declaredUncompressedSize(entry);
          if (declaredBytes !== null) {
            if (declaredBytes > MAX_FILE_BYTES) {
              skippedCount++;
              firstSkipReason ??= `${fileName} (>1 MB)`;
              continue;
            }
            if (importedBytes + declaredBytes > MAX_IMPORTED_BYTES) {
              return { error: "ZIP expands beyond the 25 MB import limit." };
            }
          }

          let content: string;
          try {
            content = await entry.async("string");
          } catch {
            skippedCount++;
            firstSkipReason ??= `${fileName} (binary/unreadable)`;
            continue;
          }
          const contentBytes = new TextEncoder().encode(content).byteLength;
          if (contentBytes > MAX_FILE_BYTES) {
            skippedCount++;
            firstSkipReason ??= `${fileName} (>1 MB)`;
            continue;
          }
          importedBytes += contentBytes;
          if (importedBytes > MAX_IMPORTED_BYTES) {
            return { error: "ZIP expands beyond the 25 MB import limit." };
          }
          if (entries.length >= MAX_IMPORTED_FILES) {
            return { error: `ZIP contains too many supported files (max ${MAX_IMPORTED_FILES}).` };
          }

          entries.push({
            id: generateId(),
            path: normalizedPath,
            name: fileName,
            language: toLanguageMode(getLanguageFromFilename(fileName)),
            content,
          });
        }

        if (entries.length === 0) {
          const detail = firstSkipReason ? ` First skipped: ${firstSkipReason}.` : "";
          return { error: `No supported text files found in ZIP.${detail}` };
        }

        entries.sort((a, b) => a.path.localeCompare(b.path));
        const folderPaths = collectFolderPaths(entries);
        if (folderPaths.length + entries.length > MAX_IMPORTED_DOCUMENTS) {
          return {
            error: `ZIP creates too many files and folders (max ${MAX_IMPORTED_DOCUMENTS}).`,
          };
        }

        // Sync the whole import to the backend in one bulk request, then use
        // the returned ids so the local tree matches the persisted documents.
        let folderIdByPath: Map<string, string> | undefined;
        let syncedToBackend = false;
        if (isBackendAvailable) {
          try {
            const documents: CreateDocumentPayload[] = [
              ...folderPaths.map((path): CreateDocumentPayload => ({
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
            const payload = { documents };
            const requestBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
            if (requestBytes > MAX_BULK_REQUEST_BYTES) {
              return {
                error: 'ZIP metadata and content exceed the 26 MB request limit.',
              };
            }
            const created = await bulkCreateDocuments(workspaceId!, payload);
            const idByPath = new Map(created.map((doc) => [doc.path, doc.id]));
            folderIdByPath = idByPath;
            for (const entry of entries) {
              const backendId = idByPath.get(normalizePath(entry.path));
              if (backendId !== undefined) entry.id = backendId;
            }
            syncedToBackend = true;
          } catch {
            return { error: "Could not sync the ZIP import. Please try again." };
          }
        }

        const { nodes, contentMap } = buildTreeFromEntries(entries, folderIdByPath);

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
      if (trimmed.includes("/") || trimmed.includes("\\")) {
        return { error: "Name cannot contain path separators." };
      }

      const current = findNodePath(useWorkspaceStore.getState().files, nodeId);
      if (current === null) return { error: "That item no longer exists." };
      if (current.node.kind === "file" && !isSupportedTextFile(trimmed)) {
        return { error: "Unsupported file type." };
      }

      if (isBackendAvailable && !nodeId.startsWith("local-")) {
        try {
          const path = current.parentPath
            ? `${current.parentPath}/${trimmed}`
            : trimmed;
          await updateDocument(nodeId, {
            name: trimmed,
            path,
            ...(current.node.kind === "file"
              ? { language: getLanguageFromFilename(trimmed) }
              : {}),
          });
        } catch {
          return { error: "Could not rename the item. Please try again." };
        }
      }

      renameNode(nodeId, trimmed);
      return {};
    },
    [isBackendAvailable, renameNode],
  );

  // ── Delete file or folder ──────────────────────────────────────────────────
  const deleteItem = useCallback(
    async (nodeId: string): Promise<FileOpResult> => {
      if (isBackendAvailable && !nodeId.startsWith("local-")) {
        try {
          await deleteDocument(nodeId);
        } catch {
          return { error: "Could not delete the item. Please try again." };
        }
      }

      deleteNode(nodeId);
      return {};
    },
    [isBackendAvailable, deleteNode],
  );

  return { createFile, createFolder, openLocalFile, importZip, renameItem, deleteItem, isImporting };
}
