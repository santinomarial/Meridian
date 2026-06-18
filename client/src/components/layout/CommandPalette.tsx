import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MaterialIcon } from "../ui/MaterialIcon";
import { toast } from "../ui/Toast";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useFileOperations } from "../../hooks/useFileOperations";
import { useSaveActiveFile } from "../../hooks/useSaveActiveFile";
import { logout } from "../../lib/api";
import { flattenFileTree, searchFiles, commandMatches } from "../../lib/commandPalette";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaletteCommand {
  id: string;
  title: string;
  icon: string;
  keywords?: string;
  disabled: boolean;
  disabledReason?: string;
  run: () => void;
}

interface FileResult {
  id: string;
  name: string;
  folder: string;
}

// ── Mount gate ──────────────────────────────────────────────────────────────
// The body remounts fresh each time the palette opens, so its query/selection
// state starts clean with no syncing effect required.

export function CommandPalette() {
  const isOpen = useWorkspaceStore((s) => s.isCommandPaletteOpen);
  if (!isOpen) return null;
  return <CommandPaletteBody />;
}

function CommandPaletteBody() {
  const navigate = useNavigate();

  // ── Store state ────────────────────────────────────────────────────────────
  const files = useWorkspaceStore((s) => s.files);
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const userRole = useWorkspaceStore((s) => s.userRole);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const terminalStatus = useWorkspaceStore((s) => s.terminalStatus);
  const theme = useWorkspaceStore((s) => s.theme);

  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);
  const toggleTheme = useWorkspaceStore((s) => s.toggleTheme);
  const toggleTerminal = useWorkspaceStore((s) => s.toggleTerminal);
  const setSettingsOpen = useWorkspaceStore((s) => s.setSettingsOpen);
  const setVersionHistoryOpen = useWorkspaceStore((s) => s.setVersionHistoryOpen);
  const setShareRequested = useWorkspaceStore((s) => s.setShareRequested);

  const { createFile, createFolder } = useFileOperations();
  const { saveActiveFile, canSaveActiveFile } = useSaveActiveFile();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLLIElement>(null);

  // ── Derived role / availability ──────────────────────────────────────────────
  const isViewer = userRole === "VIEWER";
  const isOwner = userRole === "OWNER";
  const hasActiveBackendFile =
    activeFileId !== null && !activeFileId.startsWith("local-");
  const canViewHistory = backendStatus === "available" && hasActiveBackendFile;

  const close = useCallback(() => {
    setCommandPaletteOpen(false);
  }, [setCommandPaletteOpen]);

  // Autofocus the search input on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ── Commands ─────────────────────────────────────────────────────────────────
  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];

    // New File / New Folder — editor+ only.
    list.push({
      id: "new-file",
      title: "New File",
      icon: "note_add",
      keywords: "create add",
      disabled: isViewer,
      disabledReason: "Requires editor access",
      run: () => {
        const name = window.prompt("New file name (e.g. app.ts):");
        if (name && name.trim()) {
          void createFile(name.trim()).then((r) => {
            if (r.error) toast(r.error, "error");
          });
        }
      },
    });
    list.push({
      id: "new-folder",
      title: "New Folder",
      icon: "create_new_folder",
      keywords: "create add directory",
      disabled: isViewer,
      disabledReason: "Requires editor access",
      run: () => {
        const name = window.prompt("New folder name:");
        if (name && name.trim()) {
          void createFolder(name.trim()).then((r) => {
            if (r.error) toast(r.error, "error");
          });
        }
      },
    });

    // Save Active File — needs an active file, a backend, and edit rights.
    const saveReason = isViewer
      ? "Requires editor access"
      : activeFileId === null
        ? "Open a file first"
        : backendStatus !== "available"
          ? "Connect a backend to save"
          : undefined;
    list.push({
      id: "save-file",
      title: "Save Active File",
      icon: "save",
      keywords: "write persist",
      disabled: !canSaveActiveFile,
      disabledReason: saveReason,
      run: () => {
        void saveActiveFile().then((ok) => {
          toast(ok ? "Saved." : "Save failed.", ok ? "success" : "error");
        });
      },
    });

    // Version History — viewers may view/diff (just not restore).
    list.push({
      id: "version-history",
      title: "Open Version History",
      icon: "history",
      keywords: "versions diff restore history",
      disabled: !canViewHistory,
      disabledReason:
        activeFileId === null
          ? "Open a file first"
          : !hasActiveBackendFile
            ? "Save the file first"
            : backendStatus !== "available"
              ? "Backend unavailable"
              : undefined,
      run: () => setVersionHistoryOpen(true),
    });

    // Toggle Terminal — terminal use needs editor access and a workspace.
    const terminalReason =
      workspaceId === null
        ? "No workspace loaded"
        : isViewer
          ? "Requires editor access"
          : terminalStatus === "disabled"
            ? "Terminal is disabled"
            : undefined;
    list.push({
      id: "toggle-terminal",
      title: "Toggle Terminal",
      icon: "terminal",
      keywords: "shell console",
      disabled: terminalReason !== undefined,
      disabledReason: terminalReason,
      run: () => toggleTerminal(),
    });

    // Panel / theme toggles — available to everyone, including viewers.
    list.push({
      id: "toggle-theme",
      title: "Toggle Theme",
      icon: theme === "dark" ? "light_mode" : "dark_mode",
      keywords: "dark light appearance",
      disabled: false,
      run: () => toggleTheme(),
    });
    list.push({
      id: "toggle-explorer",
      title: "Toggle Explorer",
      icon: "folder_open",
      keywords: "files sidebar panel",
      disabled: false,
      run: () => togglePanel("explorer"),
    });
    list.push({
      id: "toggle-collaboration",
      title: "Toggle Collaboration Panel",
      icon: "group",
      keywords: "presence chat collaborators panel",
      disabled: false,
      run: () => togglePanel("collaboration"),
    });

    // Share — owner only; omitted entirely for everyone else.
    if (isOwner) {
      list.push({
        id: "share-workspace",
        title: "Share Workspace",
        icon: "share",
        keywords: "invite collaborators link",
        disabled: false,
        run: () => setShareRequested(true),
      });
    }

    // Settings + Sign out — available to everyone.
    list.push({
      id: "open-settings",
      title: "Open Settings",
      icon: "settings",
      keywords: "preferences profile account",
      disabled: false,
      run: () => setSettingsOpen(true),
    });
    list.push({
      id: "sign-out",
      title: "Sign Out",
      icon: "logout",
      keywords: "logout exit leave",
      disabled: false,
      run: () => {
        void logout().catch(() => {
          // OK if the backend is unavailable — navigate away regardless.
        });
        navigate("/");
        toast("Signed out.");
      },
    });

    return list;
  }, [
    isViewer,
    isOwner,
    activeFileId,
    backendStatus,
    canSaveActiveFile,
    canViewHistory,
    hasActiveBackendFile,
    workspaceId,
    terminalStatus,
    theme,
    createFile,
    createFolder,
    saveActiveFile,
    setVersionHistoryOpen,
    toggleTerminal,
    toggleTheme,
    togglePanel,
    setShareRequested,
    setSettingsOpen,
    navigate,
  ]);

  // ── Filtered results ─────────────────────────────────────────────────────────
  const fileResults = useMemo<FileResult[]>(() => {
    const flat = flattenFileTree(files);
    return searchFiles(flat, query).map((f) => ({
      id: f.id,
      name: f.name,
      folder: f.folder,
    }));
  }, [files, query]);

  const commandResults = useMemo(
    () => commands.filter((c) => commandMatches(query, c.title, c.keywords)),
    [commands, query],
  );

  // Selectable items in render order (files first, then enabled commands).
  // Disabled commands are shown but skipped by keyboard navigation and cannot
  // be executed.
  const selectable = useMemo(() => {
    const items: { kind: "file" | "command"; id: string }[] = [];
    for (const f of fileResults) items.push({ kind: "file", id: f.id });
    for (const c of commandResults) {
      if (!c.disabled) items.push({ kind: "command", id: c.id });
    }
    return items;
  }, [fileResults, commandResults]);

  const selectableIndexById = useMemo(() => {
    const map = new Map<string, number>();
    selectable.forEach((item, i) => map.set(`${item.kind}:${item.id}`, i));
    return map;
  }, [selectable]);

  // Reset the highlight whenever the result set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const runFile = useCallback(
    (fileId: string) => {
      close();
      openFile(fileId);
    },
    [close, openFile],
  );

  const runCommand = useCallback(
    (command: PaletteCommand) => {
      if (command.disabled) return;
      close();
      command.run();
    },
    [close],
  );

  const runSelectableAt = useCallback(
    (index: number) => {
      const item = selectable[index];
      if (item === undefined) return;
      if (item.kind === "file") {
        runFile(item.id);
      } else {
        const command = commandResults.find((c) => c.id === item.id);
        if (command) runCommand(command);
      }
    },
    [selectable, commandResults, runFile, runCommand],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (selectable.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % selectable.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + selectable.length) % selectable.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        runSelectableAt(selectedIndex);
      }
    },
    [close, selectable.length, selectedIndex, runSelectableAt],
  );

  const isEmpty = fileResults.length === 0 && commandResults.length === 0;
  const activeDescendant =
    selectable[selectedIndex] !== undefined
      ? `cmdk-${selectable[selectedIndex]!.kind}-${selectable[selectedIndex]!.id}`
      : undefined;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-testid="command-palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border meridian-crisp-border bg-surface-container shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b meridian-crisp-border px-3 py-2.5">
          <MaterialIcon name="search" className="text-[18px] text-on-surface-variant" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files and commands…"
            aria-label="Search files and commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={activeDescendant}
            autoComplete="off"
            spellCheck={false}
            data-testid="command-palette-input"
            className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
          />
          <kbd className="hidden rounded border meridian-crisp-border px-1.5 py-0.5 text-[10px] text-on-surface-variant sm:block">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <ul
          id="command-palette-list"
          role="listbox"
          aria-label="Results"
          data-testid="command-palette-results"
          className="min-h-0 flex-1 overflow-y-auto py-1"
        >
          {isEmpty ? (
            <li
              role="presentation"
              className="px-3 py-6 text-center text-xs text-on-surface-variant"
              data-testid="command-palette-empty"
            >
              No matching files or commands.
            </li>
          ) : null}

          {fileResults.length > 0 ? (
            <li role="presentation">
              <GroupHeading>Files</GroupHeading>
            </li>
          ) : null}
          {fileResults.map((file) => {
            const navIndex = selectableIndexById.get(`file:${file.id}`) ?? -1;
            const isSelected = navIndex === selectedIndex;
            return (
              <ResultRow
                key={`file-${file.id}`}
                id={`cmdk-file-${file.id}`}
                ref={isSelected ? selectedRef : undefined}
                icon="description"
                title={file.name}
                hint={file.folder}
                selected={isSelected}
                disabled={false}
                testid="command-palette-file"
                dataId={file.id}
                onMouseEnter={() => navIndex >= 0 && setSelectedIndex(navIndex)}
                onClick={() => runFile(file.id)}
              />
            );
          })}

          {commandResults.length > 0 ? (
            <li role="presentation">
              <GroupHeading>Commands</GroupHeading>
            </li>
          ) : null}
          {commandResults.map((command) => {
            const navIndex = selectableIndexById.get(`command:${command.id}`) ?? -1;
            const isSelected = !command.disabled && navIndex === selectedIndex;
            return (
              <ResultRow
                key={`command-${command.id}`}
                id={`cmdk-command-${command.id}`}
                ref={isSelected ? selectedRef : undefined}
                icon={command.icon}
                title={command.title}
                hint={command.disabled ? command.disabledReason : undefined}
                selected={isSelected}
                disabled={command.disabled}
                testid="command-palette-command"
                dataId={command.id}
                onMouseEnter={() => navIndex >= 0 && setSelectedIndex(navIndex)}
                onClick={() => runCommand(command)}
              />
            );
          })}
        </ul>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t meridian-crisp-border px-3 py-1.5 text-[10px] text-on-surface-variant">
          <span>↑↓ to navigate · ↵ to run · Esc to close</span>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
      {children}
    </div>
  );
}

interface ResultRowProps {
  id: string;
  icon: string;
  title: string;
  hint?: string;
  selected: boolean;
  disabled: boolean;
  testid: string;
  dataId: string;
  onMouseEnter: () => void;
  onClick: () => void;
}

const ResultRow = forwardRef<HTMLLIElement, ResultRowProps>(function ResultRow(
  { id, icon, title, hint, selected, disabled, testid, dataId, onMouseEnter, onClick },
  ref,
) {
  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled}
      data-testid={testid}
      data-command-id={dataId}
      data-disabled={disabled ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => e.preventDefault()} // keep input focus
      onClick={disabled ? undefined : onClick}
      className={[
        "mx-1 flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm",
        disabled
          ? "cursor-not-allowed text-on-surface-variant/40"
          : selected
            ? "cursor-pointer bg-primary/15 text-on-surface"
            : "cursor-pointer text-on-surface",
      ].join(" ")}
    >
      <MaterialIcon
        name={icon}
        className={[
          "shrink-0 text-[16px]",
          disabled ? "text-on-surface-variant/40" : "text-on-surface-variant",
        ].join(" ")}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {hint ? (
        <span
          className={[
            "shrink-0 truncate text-[11px]",
            disabled ? "text-on-surface-variant/50" : "text-on-surface-variant/70",
          ].join(" ")}
        >
          {hint}
        </span>
      ) : null}
    </li>
  );
});
