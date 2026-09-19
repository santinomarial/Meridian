import { getLanguageFromFilename, toLanguageMode } from "./language";
import type { ApiDocument } from "./api";
import type { FileNode } from "../types";

export function buildFileNodes(docs: ApiDocument[]): FileNode[] {
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
    const lang = doc.language ?? null;
    return {
      kind: "file",
      id: doc.id,
      name: doc.name,
      language: toLanguageMode(
        lang !== null ? lang : getLanguageFromFilename(doc.name),
      ),
    };
  });
}

export function collectFileContent(docs: ApiDocument[], acc: Record<string, string>): void {
  for (const doc of docs) {
    if (doc.type === "FILE") {
      acc[doc.id] = doc.content ?? "";
    }
    collectFileContent(doc.children ?? [], acc);
  }
}

