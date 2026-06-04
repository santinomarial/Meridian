import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { MaterialIcon } from "../ui/MaterialIcon";
import { PanelSkeleton } from "../ui/Skeleton";
import { EmptyState } from "../ui/EmptyState";
import { getFileIconClassName, getFileIconName } from "../../constants/fileDisplay";
import {
  focusRing,
  iconButtonMutedClass,
  panelHeaderClass,
  panelSectionLabel,
  transitionBase,
} from "../ui/styles";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useFileOperations } from "../../hooks/useFileOperations";
import type { FileNode } from "../../types";
import { getNextTreeFocusId, getVisibleTreeItems } from "./fileTreeA11y";

const INDENT_PX = 12;
const CHEVRON_W = 18;

const treeRow = [
  "flex w-full items-center gap-0.5 border-l-2 py-[3px] pr-2 text-left text-[13px] leading-snug",
  transitionBase,
  focusRing,
].join(" ");

// ---------------------------------------------------------------------------
// FileTreeNode
// ---------------------------------------------------------------------------

type FileTreeNodeProps = {
  node: FileNode;
  depth: number;
  activeFileId: string | null;
  focusedId: string | null;
  onToggleFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onFocusItem: (id: string) => void;
};

function FileTreeNode({
  node,
  depth,
  activeFileId,
  focusedId,
  onToggleFolder,
  onOpenFile,
  onFocusItem,
}: FileTreeNodeProps) {
  const paddingLeft = depth * INDENT_PX + 8;
  const isFocused = focusedId === node.id;

  if (node.kind === "folder") {
    return (
      <div role="none">
        <button
          type="button"
          role="treeitem"
          aria-expanded={node.expanded}
          tabIndex={isFocused ? 0 : -1}
          data-tree-item-id={node.id}
          onFocus={() => onFocusItem(node.id)}
          onClick={() => onToggleFolder(node.id)}
          className={[treeRow, "border-transparent text-on-surface-variant hover:bg-surface-container-high/80"].join(" ")}
          style={{ paddingLeft }}
        >
          <MaterialIcon
            name={node.expanded ? "expand_more" : "chevron_right"}
            className="w-[18px] shrink-0 text-[16px] text-outline"
            aria-hidden
          />
          <MaterialIcon name="folder" className="w-[16px] shrink-0 text-[15px] text-primary/75" aria-hidden />
          <span className="truncate">{node.name}</span>
        </button>
        {node.expanded
          ? node.children.map((child) => (
              <FileTreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                activeFileId={activeFileId}
                focusedId={focusedId}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
                onFocusItem={onFocusItem}
              />
            ))
          : null}
      </div>
    );
  }

  const isActive = activeFileId === node.id;

  return (
    <button
      type="button"
      role="treeitem"
      tabIndex={isFocused ? 0 : -1}
      data-tree-item-id={node.id}
      onFocus={() => onFocusItem(node.id)}
      onClick={() => onOpenFile(node.id)}
      className={[
        treeRow,
        isActive
          ? "border-primary bg-primary/10 font-medium text-on-surface"
          : "border-transparent text-on-surface-variant hover:bg-surface-container-high/80",
      ].join(" ")}
      style={{ paddingLeft: paddingLeft + CHEVRON_W }}
      aria-selected={isActive}
    >
      <MaterialIcon
        name={getFileIconName(node.language)}
        className={["w-[16px] shrink-0 text-[15px]", getFileIconClassName(node.language, node.name)].join(" ")}
        aria-hidden
      />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// FileExplorer
// ---------------------------------------------------------------------------

type FileExplorerProps = {
  isLoading?: boolean;
  mode?: "inline" | "drawer";
  onClose?: () => void;
};

export function FileExplorer({ isLoading = false, mode = "inline", onClose }: FileExplorerProps) {
  const files = useWorkspaceStore((s) => s.files);
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const setActiveFile = useWorkspaceStore((s) => s.setActiveFile);

  const { createFile, openLocalFile, importZip, isImporting } = useFileOperations();

  const visibleItems = useMemo(() => getVisibleTreeItems(files), [files]);
  const [focusedId, setFocusedId] = useState<string | null>(() => visibleItems[0]?.id ?? null);

  // ── Inline "new file" state ───────────────────────────────────────────────
  const [isNamingFile, setIsNamingFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const newFileInputRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const zipPickerRef = useRef<HTMLInputElement>(null);

  // Auto-focus the inline input whenever it becomes visible.
  useEffect(() => {
    if (isNamingFile) newFileInputRef.current?.focus();
  }, [isNamingFile]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleOpenFile = useCallback(
    (fileId: string) => {
      openFile(fileId);
      setActiveFile(fileId);
      if (mode === "drawer") onClose?.();
    },
    [mode, onClose, openFile, setActiveFile],
  );

  const activateFocusedItem = useCallback((): void => {
    const item = visibleItems.find((e) => e.id === focusedId);
    if (!item) return;
    if (item.node.kind === "folder") toggleFolder(item.node.id);
    else handleOpenFile(item.node.id);
  }, [focusedId, handleOpenFile, toggleFolder, visibleItems]);

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!visibleItems.length) return;
    const focusedItem = visibleItems.find((e) => e.id === focusedId);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setFocusedId(getNextTreeFocusId(visibleItems, focusedId, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setFocusedId(getNextTreeFocusId(visibleItems, focusedId, -1));
        break;
      case "ArrowRight":
        if (focusedItem?.node.kind === "folder" && !focusedItem.node.expanded) {
          event.preventDefault();
          toggleFolder(focusedItem.node.id);
        }
        break;
      case "ArrowLeft":
        if (focusedItem?.node.kind === "folder" && focusedItem.node.expanded) {
          event.preventDefault();
          toggleFolder(focusedItem.node.id);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        activateFocusedItem();
        break;
    }
  };

  // New-file inline input handlers.
  const startNaming = (): void => {
    setIsNamingFile(true);
    setNewFileName("");
    setImportError(null);
  };

  const cancelNaming = (): void => {
    setIsNamingFile(false);
    setNewFileName("");
  };

  const submitNaming = useCallback(
    async (name: string): Promise<void> => {
      setIsNamingFile(false);
      setNewFileName("");
      const result = await createFile(name);
      if (result.error) setImportError(result.error);
    },
    [createFile],
  );

  const handleNewFileKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") void submitNaming(newFileName);
    if (e.key === "Escape") cancelNaming();
  };

  const handleNewFileBlur = (): void => {
    if (newFileName.trim()) void submitNaming(newFileName);
    else cancelNaming();
  };

  // Hidden file-picker handlers.
  const handleFilePick = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      const result = await openLocalFile(file);
      if (result.error) setImportError(result.error);
    },
    [openLocalFile],
  );

  const handleZipPick = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      const result = await importZip(file);
      if (result.error) setImportError(result.error);
    },
    [importZip],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <aside
      className={[
        "meridian-panel flex h-full min-h-0 flex-col",
        mode === "inline" ? "w-60 shrink-0 meridian-crisp-border border-r" : "w-full",
      ].join(" ")}
      aria-label="Explorer"
    >
      {/* Header */}
      <div className={panelHeaderClass}>
        <span className={panelSectionLabel}>Explorer</span>
        <div className="flex items-center">
          {/* New File */}
          <button
            type="button"
            className={iconButtonMutedClass}
            aria-label="New file"
            title="New File"
            onClick={startNaming}
            disabled={isImporting}
          >
            <MaterialIcon name="note_add" className="text-[16px]" aria-hidden />
          </button>
          {/* Open local file */}
          <button
            type="button"
            className={iconButtonMutedClass}
            aria-label="Open file from computer"
            title="Open File"
            disabled={isImporting}
            onClick={() => filePickerRef.current?.click()}
          >
            <MaterialIcon name="upload_file" className="text-[16px]" aria-hidden />
          </button>
          {/* Import ZIP */}
          <button
            type="button"
            className={iconButtonMutedClass}
            aria-label="Import ZIP archive"
            title="Import ZIP"
            disabled={isImporting}
            onClick={() => zipPickerRef.current?.click()}
          >
            <MaterialIcon name="folder_zip" className="text-[16px]" aria-hidden />
          </button>
          {mode === "drawer" && onClose ? (
            <button type="button" onClick={onClose} className={iconButtonMutedClass} aria-label="Close explorer">
              <MaterialIcon name="close" className="text-[16px]" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* Hidden file pickers */}
      <input
        ref={filePickerRef}
        type="file"
        className="sr-only"
        accept=".ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.cpp,.cc,.cxx,.c,.h,.html,.css,.scss,.json,.md,.yml,.yaml,.sql,.sh,.bash,.txt"
        onChange={(e) => void handleFilePick(e)}
      />
      <input
        ref={zipPickerRef}
        type="file"
        className="sr-only"
        accept=".zip"
        onChange={(e) => void handleZipPick(e)}
      />

      {/* File tree */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-1 py-1 outline-none"
        role="tree"
        aria-label="Workspace files"
        onKeyDown={handleTreeKeyDown}
      >
        {/* Inline "new file" input */}
        {isNamingFile ? (
          <div className="flex items-center gap-1 border-l-2 border-primary px-2 py-[3px]">
            <MaterialIcon name="note_add" className="shrink-0 text-[15px] text-primary" aria-hidden />
            <input
              ref={newFileInputRef}
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={handleNewFileKeyDown}
              onBlur={handleNewFileBlur}
              placeholder="filename.ts"
              className="flex-1 bg-transparent text-[13px] text-on-surface outline-none placeholder:text-outline"
              aria-label="New file name"
            />
          </div>
        ) : null}

        {/* Importing spinner */}
        {isImporting ? (
          <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-on-surface-variant">
            <MaterialIcon name="sync" className="animate-spin text-[14px]" aria-hidden />
            Importing…
          </div>
        ) : null}

        {isLoading ? (
          <PanelSkeleton rows={9} />
        ) : files.length === 0 && !isNamingFile ? (
          <EmptyState icon="folder_off" title="No files" description="This workspace has no files yet" />
        ) : (
          files.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              depth={0}
              activeFileId={activeFileId}
              focusedId={focusedId}
              onToggleFolder={toggleFolder}
              onOpenFile={handleOpenFile}
              onFocusItem={setFocusedId}
            />
          ))
        )}
      </div>

      {/* Error banner */}
      {importError !== null ? (
        <div className="flex items-start gap-2 border-t border-error/20 bg-error/5 px-3 py-2 text-[11px] text-error">
          <MaterialIcon name="error_outline" className="mt-px shrink-0 text-[14px]" aria-hidden />
          <span className="flex-1">{importError}</span>
          <button
            type="button"
            onClick={() => setImportError(null)}
            className="shrink-0 text-on-surface-variant hover:text-on-surface"
            aria-label="Dismiss error"
          >
            <MaterialIcon name="close" className="text-[13px]" aria-hidden />
          </button>
        </div>
      ) : null}
    </aside>
  );
}
