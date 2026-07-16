import { FileLanguageIcon } from "../../constants/fileDisplay";
import { MaterialIcon } from "../ui/MaterialIcon";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import type { FileNode } from "../../types";

function findFilePath(
  nodes: FileNode[],
  fileId: string,
  trail: FileNode[] = [],
): FileNode[] | null {
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.kind === "file" && node.id === fileId) return nextTrail;
    if (node.kind === "folder") {
      const found = findFilePath(node.children, fileId, nextTrail);
      if (found) return found;
    }
  }
  return null;
}

type BreadcrumbSegments = {
  folders: string[];
  file: Extract<FileNode, { kind: "file" }>;
};

function toBreadcrumbSegments(trail: FileNode[]): BreadcrumbSegments | null {
  const last = trail[trail.length - 1];
  if (!last || last.kind !== "file") return null;

  const folders = trail
    .slice(0, -1)
    .filter((n): n is Extract<FileNode, { kind: "folder" }> => n.kind === "folder")
    .map((n) => n.name);

  if (folders.length > 0) folders.shift();
  return { folders, file: last };
}

export function Breadcrumb() {
  const files = useWorkspaceStore((state) => state.files);
  const activeFileId = useWorkspaceStore((state) => state.activeFileId);
  const trail = activeFileId ? findFilePath(files, activeFileId) : null;
  const segments = trail ? toBreadcrumbSegments(trail) : null;

  return (
    <nav
      className="flex h-8 shrink-0 items-center gap-1.5 meridian-crisp-border border-b bg-surface-container-low px-3 text-[12px] text-on-surface-variant"
      aria-label="File breadcrumb"
    >
      <MaterialIcon name="folder_open" className="shrink-0 text-[14px] text-primary/90" aria-hidden />

      {segments ? (
        <ol className="flex min-w-0 items-center gap-1">
          {segments.folders.map((folder, index) => (
            <li key={`${folder}-${index}`} className="flex items-center gap-1">
              <span className="truncate">{folder}</span>
              <MaterialIcon name="chevron_right" className="shrink-0 text-[10px] text-outline" aria-hidden />
            </li>
          ))}
          <li className="flex min-w-0 items-center gap-1 font-medium text-on-surface">
            <FileLanguageIcon
              language={segments.file.language}
              fileName={segments.file.name}
              size={14}
            />
            <span className="truncate">{segments.file.name}</span>
          </li>
        </ol>
      ) : (
        <span className="truncate italic opacity-50">No file open</span>
      )}
    </nav>
  );
}
