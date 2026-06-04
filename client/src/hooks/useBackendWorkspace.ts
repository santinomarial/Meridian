import { useEffect } from "react";
import { getCurrentUser, getDocumentTree, getWorkspaces } from "../lib/api";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { ApiDocument } from "../lib/api";
import type { FileNode, LanguageMode } from "../types";

const LANGUAGE_MAP: Record<string, LanguageMode> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  html: "html",
  css: "css",
  scss: "css",
  json: "json",
};

const VALID_LANGUAGES = new Set<string>([
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "html",
  "css",
  "json",
]);

function toLanguage(raw: string | null, name: string): LanguageMode {
  if (raw !== null && VALID_LANGUAGES.has(raw)) return raw as LanguageMode;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_MAP[ext] ?? "typescript";
}

function buildFileNodes(docs: ApiDocument[]): FileNode[] {
  return docs.map((doc): FileNode => {
    if (doc.type === "FOLDER") {
      return {
        kind: "folder",
        id: doc.id,
        name: doc.name,
        children: buildFileNodes(doc.children ?? []),
        expanded: true,
      };
    }
    return {
      kind: "file",
      id: doc.id,
      name: doc.name,
      language: toLanguage(doc.language, doc.name),
    };
  });
}

function collectFileContent(docs: ApiDocument[], acc: Record<string, string>): void {
  for (const doc of docs) {
    if (doc.type === "FILE") {
      acc[doc.id] = doc.content ?? "";
    }
    collectFileContent(doc.children ?? [], acc);
  }
}

function findFirstFileId(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "file") return node.id;
    if (node.kind === "folder") {
      const found = findFirstFileId(node.children);
      if (found !== null) return found;
    }
  }
  return null;
}

export function useBackendWorkspace(): void {
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        // Best-effort auth check — failure is fine (unauthenticated users still see workspace)
        try {
          await getCurrentUser();
        } catch {
          // not authenticated
        }

        const workspaces = await getWorkspaces();
        if (cancelled) return;

        const workspace =
          workspaces.find((w) => w.name.toLowerCase().includes("meridian")) ??
          workspaces[0];

        if (workspace === undefined) {
          useWorkspaceStore.getState().setBackendStatus("unavailable");
          return;
        }

        useWorkspaceStore.getState().setWorkspaceId(workspace.id);

        const tree = await getDocumentTree(workspace.id);
        if (cancelled) return;

        const files = buildFileNodes(tree);
        const editorContent: Record<string, string> = {};
        collectFileContent(tree, editorContent);
        const defaultFileId = findFirstFileId(files);

        useWorkspaceStore.getState().batchLoadBackend({ files, editorContent, defaultFileId });
        useWorkspaceStore.getState().setBackendStatus("available");
      } catch {
        if (!cancelled) {
          useWorkspaceStore.getState().setBackendStatus("unavailable");
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);
}
