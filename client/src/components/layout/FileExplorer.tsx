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
  renamingId: string | null;
  renameValue: string;
  readOnly: boolean;
  onToggleFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onFocusItem: (id: string) => void;
  onStartRename: (id: string, currentName: string) => void;
  onRenameChange: (value: string) => void;
  onRenameSubmit: (id: string) => void;
  onRenameCancel: () => void;
  onDeleteNode: (id: string, name: string) => void;
};

function FileTreeNode({
  node,
  depth,
  activeFileId,
  focusedId,
  renamingId,
  renameValue,
  readOnly,
  onToggleFolder,
  onOpenFile,
  onFocusItem,
  onStartRename,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onDeleteNode,
}: FileTreeNodeProps) {
  const paddingLeft = depth * INDENT_PX + 8;
  const isFocused = focusedId === node.id;
  const isRenaming = renamingId === node.id;

  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  const sharedActionButtons = readOnly ? null : (
    <div
      className="absolute right-0.5 top-1/2 flex -translate-y-1/2 items-center gap-px opacity-0 group-hover:opacity-100"
      // Stop propagation so clicking these buttons doesn't open/toggle the parent row.
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        tabIndex={-1}
        className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-surface-container-highest"
        aria-label={`Rename ${node.name}`}
        title="Rename"
        onClick={() => onStartRename(node.id, node.name)}
      >
        <MaterialIcon name="edit" className="text-[12px] text-on-surface-variant" aria-hidden />
      </button>
      <button
        type="button"
        tabIndex={-1}
        className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-error/10"
        aria-label={`Delete ${node.name}`}
        title="Delete"
        onClick={() => onDeleteNode(node.id, node.name)}
      >
        <MaterialIcon name="delete" className="text-[12px] text-error/70 hover:text-error" aria-hidden />
      </button>
    </div>
  );

  if (node.kind === "folder") {
    return (
      <div role="none">
        <div className="group relative" role="none">
          {isRenaming ? (
            <div
              className="flex items-center gap-0.5 border-l-2 border-primary py-[3px] pr-2"
              style={{ paddingLeft }}
            >
              <MaterialIcon
                name={node.expanded ? "expand_more" : "chevron_right"}
                className="w-[18px] shrink-0 text-[16px] text-outline"
                aria-hidden
              />
              <MaterialIcon name="folder" className="w-[16px] shrink-0 text-[15px] text-primary/75" aria-hidden />
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => onRenameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRenameSubmit(node.id);
                  if (e.key === "Escape") onRenameCancel();
                }}
                onBlur={() => onRenameSubmit(node.id)}
                className="flex-1 bg-transparent text-[13px] text-on-surface outline-none"
                aria-label="Rename folder"
              />
            </div>
          ) : (
            <button
              type="button"
              role="treeitem"
              aria-expanded={node.expanded}
              tabIndex={isFocused ? 0 : -1}
              data-tree-item-id={node.id}
              data-testid="folder-tree-item"
              data-node-name={node.name}
              data-node-id={node.id}
              onFocus={() => onFocusItem(node.id)}
              onClick={() => onToggleFolder(node.id)}
              className={[treeRow, "border-transparent text-on-surface-variant hover:bg-surface-container-high/80 pr-14"].join(" ")}
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
          )}
          {!isRenaming ? sharedActionButtons : null}
        </div>
        {node.expanded
          ? node.children.map((child) => (
              <FileTreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                activeFileId={activeFileId}
                focusedId={focusedId}
                renamingId={renamingId}
                renameValue={renameValue}
                readOnly={readOnly}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
                onFocusItem={onFocusItem}
                onStartRename={onStartRename}
                onRenameChange={onRenameChange}
                onRenameSubmit={onRenameSubmit}
                onRenameCancel={onRenameCancel}
                onDeleteNode={onDeleteNode}
              />
            ))
          : null}
      </div>
    );
  }

  const isActive = activeFileId === node.id;

  return (
    <div className="group relative" role="none">
      {isRenaming ? (
        <div
          className="flex items-center gap-0.5 border-l-2 border-primary py-[3px] pr-2"
          style={{ paddingLeft: paddingLeft + CHEVRON_W }}
        >
          <MaterialIcon
            name={getFileIconName(node.language)}
            className={["w-[16px] shrink-0 text-[15px]", getFileIconClassName(node.language, node.name)].join(" ")}
            aria-hidden
          />
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit(node.id);
              if (e.key === "Escape") onRenameCancel();
            }}
            onBlur={() => onRenameSubmit(node.id)}
            className="flex-1 bg-transparent text-[13px] text-on-surface outline-none"
            aria-label="Rename file"
          />
        </div>
      ) : (
        <button
          type="button"
          role="treeitem"
          tabIndex={isFocused ? 0 : -1}
          data-tree-item-id={node.id}
          data-testid="file-tree-item"
          data-node-name={node.name}
          data-node-id={node.id}
          onFocus={() => onFocusItem(node.id)}
          onClick={() => onOpenFile(node.id)}
          className={[
            treeRow,
            "pr-14",
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
      )}
      {!isRenaming ? sharedActionButtons : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileExplorer
// ---------------------------------------------------------------------------

type FileExplorerProps = {
  isLoading?: boolean;
  mode?: "inline" | "drawer";
  onClose?: () => void;
  readOnly?: boolean;
};

type NamingTarget = "file" | "folder";

export function FileExplorer({ isLoading = false, mode = "inline", onClose, readOnly = false }: FileExplorerProps) {
  const files = useWorkspaceStore((s) => s.files);
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const toggleFolder = useWorkspaceStore((s) => s.toggleFolder);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const setActiveFile = useWorkspaceStore((s) => s.setActiveFile);

  const { createFile, createFolder, openLocalFile, importZip, renameItem, deleteItem, isImporting } =
    useFileOperations();

  const visibleItems = useMemo(() => getVisibleTreeItems(files), [files]);
  const [focusedId, setFocusedId] = useState<string | null>(() => visibleItems[0]?.id ?? null);

  // ── New file/folder naming state ──────────────────────────────────────────
  const [namingTarget, setNamingTarget] = useState<NamingTarget | null>(null);
  const [newItemName, setNewItemName] = useState("");

  // ── Rename state ──────────────────────────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // ── Error banner ──────────────────────────────────────────────────────────
  const [importError, setImportError] = useState<string | null>(null);

  const newItemInputRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const zipPickerRef = useRef<HTMLInputElement>(null);
  // Prevents Enter keydown + subsequent blur from calling submitNaming twice.
  const submittingRef = useRef(false);
  // Prevents Enter keydown + subsequent blur from calling handleRenameSubmit twice.
  const renamingRef = useRef(false);

  useEffect(() => {
    if (namingTarget !== null) newItemInputRef.current?.focus();
  }, [namingTarget]);

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

  // ── New item naming ────────────────────────────────────────────────────────

  const startNaming = (target: NamingTarget): void => {
    setNamingTarget(target);
    setNewItemName("");
    setImportError(null);
  };

  const cancelNaming = (): void => {
    setNamingTarget(null);
    setNewItemName("");
  };

  const submitNaming = useCallback(
    async (name: string): Promise<void> => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      const target = namingTarget;
      setNamingTarget(null);
      setNewItemName("");
      if (!target) {
        submittingRef.current = false;
        return;
      }
      try {
        const result = target === "file" ? await createFile(name) : await createFolder(name);
        if (result.error) setImportError(result.error);
      } finally {
        submittingRef.current = false;
      }
    },
    [namingTarget, createFile, createFolder],
  );

  const handleNewItemKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") void submitNaming(newItemName);
    if (e.key === "Escape") cancelNaming();
  };

  const handleNewItemBlur = (): void => {
    if (newItemName.trim()) void submitNaming(newItemName);
    else cancelNaming();
  };

  // ── File picker handlers ───────────────────────────────────────────────────

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

  // ── Rename handlers ────────────────────────────────────────────────────────

  const handleStartRename = useCallback((id: string, currentName: string): void => {
    setRenamingId(id);
    setRenameValue(currentName);
  }, []);

  const handleRenameSubmit = useCallback(
    async (id: string): Promise<void> => {
      if (renamingRef.current) return;
      renamingRef.current = true;
      setRenamingId(null);
      const name = renameValue.trim();
      if (!name) {
        renamingRef.current = false;
        return;
      }
      try {
        const result = await renameItem(id, name);
        if (result.error) setImportError(result.error);
      } finally {
        renamingRef.current = false;
      }
    },
    [renameValue, renameItem],
  );

  const handleRenameCancel = useCallback((): void => {
    setRenamingId(null);
    setRenameValue("");
  }, []);

  // ── Delete handler ─────────────────────────────────────────────────────────

  const handleDeleteNode = useCallback(
    async (id: string, name: string): Promise<void> => {
      const confirmed = window.confirm(`Delete "${name}"? This cannot be undone.`);
      if (!confirmed) return;
      const result = await deleteItem(id);
      if (result.error) setImportError(result.error);
    },
    [deleteItem],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const namingIcon = namingTarget === "folder" ? "create_new_folder" : "note_add";
  const namingPlaceholder = namingTarget === "folder" ? "folder-name" : "filename.ts";

  return (
    <aside
      className={[
        "meridian-panel flex h-full min-h-0 flex-col",
        mode === "inline" ? "w-60 shrink-0 meridian-crisp-border border-r" : "w-full",
      ].join(" ")}
      aria-label="Explorer"
      data-testid="file-explorer"
    >
      {/* Header */}
      <div className={panelHeaderClass}>
        <span className={panelSectionLabel}>Explorer</span>
        <div className="flex items-center">
          {!readOnly && (
            <>
              {/* New File */}
              <button
                type="button"
                className={iconButtonMutedClass}
                aria-label="New file"
                title="New File"
                onClick={() => startNaming("file")}
                disabled={isImporting}
                data-testid="new-file-button"
              >
                <MaterialIcon name="note_add" className="text-[16px]" aria-hidden />
              </button>
              {/* New Folder */}
              <button
                type="button"
                className={iconButtonMutedClass}
                aria-label="New folder"
                title="New Folder"
                onClick={() => startNaming("folder")}
                disabled={isImporting}
                data-testid="new-folder-button"
              >
                <MaterialIcon name="create_new_folder" className="text-[16px]" aria-hidden />
              </button>
              {/* Open local file */}
              <button
                type="button"
                className={iconButtonMutedClass}
                aria-label="Open file from computer"
                title="Open File"
                disabled={isImporting}
                onClick={() => filePickerRef.current?.click()}
                data-testid="open-file-button"
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
                data-testid="import-zip-button"
              >
                <MaterialIcon name="folder_zip" className="text-[16px]" aria-hidden />
              </button>
            </>
          )}
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
        data-testid="file-picker-input"
      />
      <input
        ref={zipPickerRef}
        type="file"
        className="sr-only"
        accept=".zip"
        onChange={(e) => void handleZipPick(e)}
        data-testid="zip-picker-input"
      />

      {/* File tree */}
      <div
        className="min-h-0 flex-1 overflow-y-auto px-1 py-1 outline-none"
        role="tree"
        aria-label="Workspace files"
        onKeyDown={handleTreeKeyDown}
      >
        {/* Inline "new file/folder" input */}
        {namingTarget !== null ? (
          <div className="flex items-center gap-1 border-l-2 border-primary px-2 py-[3px]">
            <MaterialIcon name={namingIcon} className="shrink-0 text-[15px] text-primary" aria-hidden />
            <input
              ref={newItemInputRef}
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={handleNewItemKeyDown}
              onBlur={handleNewItemBlur}
              placeholder={namingPlaceholder}
              className="flex-1 bg-transparent text-[13px] text-on-surface outline-none placeholder:text-outline"
              aria-label={namingTarget === "folder" ? "New folder name" : "New file name"}
              data-testid="new-item-input"
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
        ) : files.length === 0 && namingTarget === null ? (
          <EmptyState icon="folder_off" title="No files" description="This workspace has no files yet" />
        ) : (
          files.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              depth={0}
              activeFileId={activeFileId}
              focusedId={focusedId}
              renamingId={renamingId}
              renameValue={renameValue}
              readOnly={readOnly}
              onToggleFolder={toggleFolder}
              onOpenFile={handleOpenFile}
              onFocusItem={setFocusedId}
              onStartRename={handleStartRename}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSubmit}
              onRenameCancel={handleRenameCancel}
              onDeleteNode={handleDeleteNode}
            />
          ))
        )}
      </div>

      {/* Error / info banner */}
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
