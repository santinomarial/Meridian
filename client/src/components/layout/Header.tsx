import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { MeridianWordmark } from "../ui/MeridianWordmark";
import { MaterialIcon } from "../ui/MaterialIcon";
import { toast } from "../ui/Toast";
import {
  headerButtonPrimary,
  headerButtonSecondary,
  iconButtonMutedClass,
  navButtonClass,
} from "../ui/styles";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useFileOperations } from "../../hooks/useFileOperations";
import { useSaveActiveFile } from "../../hooks/useSaveActiveFile";
import { useRunActiveFile } from "../../hooks/useRunActiveFile";
import { useExportWorkspace } from "../../hooks/useExportWorkspace";
import { createInvite, logout, ApiError } from "../../lib/api";
import { getActiveEditor } from "../../lib/editorRegistry";
import type { Collaborator } from "../../types";

// ── Types ─────────────────────────────────────────────────────────────────────

type NavItem = "File" | "Edit" | "Selection" | "View" | "Go";

type OpenPanel =
  | "file-menu"
  | "edit-menu"
  | "selection-menu"
  | "view-menu"
  | "go-menu"
  | "collaborators"
  | "share"
  | "notifications"
  | "account"
  | null;

type MenuEntry = {
  label: string;
  icon?: string;
  onClick: () => void;
  sep?: true;
  danger?: boolean;
  requiresEdit?: true;
  disabled?: boolean;
};

type InviteRole = "EDITOR" | "VIEWER";

// ── Constants ─────────────────────────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = ["File", "Edit", "Selection", "View", "Go"];
const MAX_VISIBLE_COLLABORATORS = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CollaboratorAvatar({ collaborator }: { collaborator: Collaborator }) {
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-surface text-[10px] font-bold text-on-primary"
      style={{ backgroundColor: collaborator.color }}
      title={collaborator.name}
    >
      {getInitials(collaborator.name)}
    </span>
  );
}

function OverflowAvatar({ count }: { count: number }) {
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-surface bg-surface-container-highest text-[10px] font-bold text-on-surface-variant"
      title={`${count} more collaborators`}
    >
      +{count}
    </span>
  );
}

function DropdownPanel({ children, className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "absolute z-50 mt-1 min-w-[10rem] rounded-md border meridian-crisp-border bg-surface-container shadow-xl ring-1 ring-black/5 dark:ring-white/5",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

function MenuItem({
  label,
  icon,
  onClick,
  danger = false,
  disabled = false,
  role,
}: MenuEntry & { role?: "menuitem" }) {
  return (
    <button
      type="button"
      role={role}
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-75",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
        disabled
          ? "cursor-not-allowed text-on-surface-variant/40"
          : "hover:bg-surface-container-high",
        disabled ? "" : danger ? "text-error" : "text-on-surface",
      ].join(" ")}
    >
      {icon !== undefined ? (
        <MaterialIcon name={icon} className="shrink-0 text-[14px] text-on-surface-variant" aria-hidden />
      ) : (
        <span className="w-[14px] shrink-0" />
      )}
      {label}
    </button>
  );
}

function MenuSeparator() {
  return <hr className="my-1 border-t meridian-crisp-border" />;
}

// ── Main component ────────────────────────────────────────────────────────────

export function Header() {
  const navigate = useNavigate();

  // ── Store ──────────────────────────────────────────────────────────────────
  const userRole = useWorkspaceStore((s) => s.userRole);
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const isViewer =
    backendStatus !== "unavailable" &&
    userRole !== "OWNER" &&
    userRole !== "EDITOR";
  const isOwner = backendStatus === "available" && userRole === "OWNER";
  const collaborators = useWorkspaceStore((s) => s.collaborators);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const theme = useWorkspaceStore((s) => s.theme);
  const toggleTheme = useWorkspaceStore((s) => s.toggleTheme);
  const connectionStatus = useWorkspaceStore((s) => s.connectionStatus);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);
  const isExplorerOpen = useWorkspaceStore((s) => s.isExplorerOpen);
  const isCollaborationPanelOpen = useWorkspaceStore((s) => s.isCollaborationPanelOpen);
  const toggleTerminal = useWorkspaceStore((s) => s.toggleTerminal);
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const notifications = useWorkspaceStore((s) => s.notifications);
  const clearNotifications = useWorkspaceStore((s) => s.clearNotifications);
  const addNotification = useWorkspaceStore((s) => s.addNotification);
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace);
  const setSettingsOpen = useWorkspaceStore((s) => s.setSettingsOpen);
  const toggleCommandPalette = useWorkspaceStore((s) => s.toggleCommandPalette);
  const shareRequested = useWorkspaceStore((s) => s.shareRequested);
  const setShareRequested = useWorkspaceStore((s) => s.setShareRequested);

  // ── File operations ────────────────────────────────────────────────────────
  const { createFile, createFolder, openLocalFile, importZip } = useFileOperations();
  const { saveActiveFile } = useSaveActiveFile();
  const { runActiveFile, canRun: canRunActiveFile } = useRunActiveFile();
  const { exportWorkspace, canExport } = useExportWorkspace();

  // ── Local state ────────────────────────────────────────────────────────────
  const [openPanel, setOpenPanel] = useState<OpenPanel>(null);

  // Share / invite state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("EDITOR");
  const [inviteStatus, setInviteStatus] = useState<"idle" | "sent">("idle");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const navRef = useRef<HTMLDivElement>(null);
  const collaboratorsRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // ── Outside-click handler ──────────────────────────────────────────────────
  useEffect(() => {
    if (openPanel === null) return;

    let activeRef: React.RefObject<HTMLDivElement> | null = null;
    switch (openPanel) {
      case "file-menu":
      case "edit-menu":
      case "selection-menu":
      case "view-menu":
      case "go-menu":
        activeRef = navRef;
        break;
      case "collaborators":
        activeRef = collaboratorsRef;
        break;
      case "share":
        activeRef = shareRef;
        break;
      case "notifications":
        activeRef = notificationsRef;
        break;
      case "account":
        activeRef = accountRef;
        break;
    }

    function handleMouseDown(e: MouseEvent): void {
      if (activeRef?.current && !activeRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [openPanel]);

  // ── Escape key handler ─────────────────────────────────────────────────────
  useEffect(() => {
    if (openPanel === null) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpenPanel(null);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [openPanel]);

  // Reset invite state when share panel closes
  useEffect(() => {
    if (openPanel !== "share") {
      // Intentional reset of local form state when the panel closes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInviteEmail("");
      setInviteStatus("idle");
      setCopyStatus("idle");
      setInviteToken(null);
    }
  }, [openPanel]);

  // Consume the command palette's one-shot "open Share" intent. Only owners
  // render the share panel, so non-owners simply clear the flag. Reusing the
  // real share panel keeps a single source of truth for the invite flow.
  useEffect(() => {
    if (!shareRequested) return;
    // One-shot intent handoff from the command palette; opens the real share
    // panel and immediately clears the flag. Both writes belong in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isOwner) setOpenPanel("share");
    setShareRequested(false);
  }, [shareRequested, isOwner, setShareRequested]);

  // ── Computed ───────────────────────────────────────────────────────────────
  const visibleCollaborators = collaborators.slice(0, MAX_VISIBLE_COLLABORATORS);
  const overflowCount = Math.max(0, collaborators.length - MAX_VISIBLE_COLLABORATORS);
  const isBackendAvailable = backendStatus === "available";

  // Version history needs a backend-persisted file; disable the menu entry when
  // there is no active file or it only exists locally.
  const canViewHistory =
    isBackendAvailable && activeFileId !== null && !activeFileId.startsWith("local-");

  // Create a real invite when the share panel opens (and again when the role
  // changes). Offline demo mode falls back to a non-persistent /invite/demo link.
  useEffect(() => {
    if (openPanel !== "share" || !isBackendAvailable || workspaceId === null) return;
    let cancelled = false;
    createInvite(workspaceId, { role: inviteRole })
      .then((invite) => {
        if (!cancelled) setInviteToken(invite.token);
      })
      .catch(() => {
        if (!cancelled) setInviteToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, [openPanel, isBackendAvailable, workspaceId, inviteRole]);

  const inviteLink = `${window.location.origin}/invite/${inviteToken ?? "demo"}`;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleNewFile = useCallback(async () => {
    setOpenPanel(null);
    const name = window.prompt("New file name (e.g. app.ts):");
    if (!name || !name.trim()) return;
    const result = await createFile(name.trim());
    if (result.error) toast(result.error, "error");
  }, [createFile]);

  const handleNewFolder = useCallback(async () => {
    setOpenPanel(null);
    const name = window.prompt("New folder name:");
    if (!name || !name.trim()) return;
    const result = await createFolder(name.trim());
    if (result.error) toast(result.error, "error");
  }, [createFolder]);

  const handleSave = useCallback(async () => {
    setOpenPanel(null);
    if (!isBackendAvailable || activeFileId === null) {
      toast("Nothing to save — open a file or connect the backend.", "error");
      return;
    }
    // Shared save path (same as Cmd+S and the command palette).
    const ok = await saveActiveFile();
    toast(ok ? "Saved." : "Save failed — try Cmd+S.", ok ? "success" : "error");
  }, [isBackendAvailable, activeFileId, saveActiveFile]);

  // Version history is backed by real server-side DocumentVersion records, so
  // it is only meaningful for a file that exists on the backend. The menu item
  // is disabled otherwise (see canViewHistory) — this handler is the guard for
  // the rare race where state changed between render and click.
  const setVersionHistoryOpen = useWorkspaceStore((s) => s.setVersionHistoryOpen);
  const handleVersionHistory = useCallback(() => {
    setOpenPanel(null);
    if (!isBackendAvailable || activeFileId === null || activeFileId.startsWith("local-")) {
      toast("Version history is available once a file is saved to the backend.", "error");
      return;
    }
    setVersionHistoryOpen(true);
  }, [isBackendAvailable, activeFileId, setVersionHistoryOpen]);

  const handleRunActiveFile = useCallback(() => {
    setOpenPanel(null);
    void runActiveFile();
  }, [runActiveFile]);

  const handleExportWorkspace = useCallback(() => {
    setOpenPanel(null);
    void exportWorkspace();
  }, [exportWorkspace]);

  const handleSignOut = useCallback(async () => {
    setOpenPanel(null);
    resetWorkspace();
    try {
      await logout();
    } catch {
      // OK if backend is unavailable — navigate away anyway.
    }
    navigate("/", { replace: true });
    toast("Signed out.");
  }, [navigate, resetWorkspace]);

  const handleCopyPath = useCallback(async () => {
    setOpenPanel(null);
    if (!activeFileId) {
      toast("No file open.", "error");
      return;
    }
    const tab = openTabs.find((t) => t.fileId === activeFileId);
    const path = `/workspace/${tab?.name ?? activeFileId}`;
    try {
      await navigator.clipboard.writeText(path);
      toast("Path copied.", "success");
    } catch {
      toast("Could not copy path.", "error");
    }
  }, [activeFileId, openTabs]);

  // Copies the invite link to clipboard and shows feedback
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      toast("Could not copy link.", "error");
    }
  }, [inviteLink]);

  // Creates an invite for the provided email address and emails the link.
  const handleSendInvite = useCallback(async () => {
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) {
      toast("Please enter a valid email address.", "error");
      return;
    }

    if (isBackendAvailable && workspaceId !== null) {
      try {
        const invite = await createInvite(workspaceId, { role: inviteRole, email });
        const url =
          invite.previewInviteUrl ??
          invite.inviteUrl ??
          `${window.location.origin}/invite/${invite.token}`;
        setInviteToken(invite.token);
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          // Clipboard failed — still show the link in the share panel.
        }
        addNotification({ icon: "person_add", text: `Invite created for ${email}` });

        if (invite.emailDelivered === false) {
          toast(
            invite.emailError ??
              `Invite created for ${email}, but email could not be delivered. Link copied — share it with them directly.`,
            "info",
          );
        } else {
          toast(`Invite sent to ${email}. Link copied to clipboard.`, "success");
        }
        setInviteEmail("");
        setInviteStatus("sent");
        window.setTimeout(() => setInviteStatus("idle"), 3000);
      } catch (err) {
        const message =
          err instanceof ApiError && err.message.length > 0
            ? err.message
            : "Could not create invite — try again.";
        toast(message, "error");
      }
      return;
    }

    // Offline — no backend to persist or email the invite.
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      // Clipboard failed — still show the message.
    }
    toast(`Invite link for ${email} copied. (Server offline — no email sent.)`, "info");
    setInviteEmail("");
    setInviteStatus("sent");
    window.setTimeout(() => setInviteStatus("idle"), 3000);
  }, [inviteEmail, inviteLink, inviteRole, isBackendAvailable, workspaceId, addNotification]);

  // Live Session reflects the real collaboration state. Collaboration in
  // Meridian is document-based: opening a file in a backend workspace already
  // joins a live Yjs room, so this surfaces that real state rather than
  // navigating to a fabricated session route.
  const handleLiveSession = useCallback(() => {
    if (!isBackendAvailable) {
      toast("Live session unavailable — connect the backend first.", "error");
      return;
    }
    if (!activeFileId) {
      toast("Open a file to start a live session.");
      return;
    }
    if (!isCollaborationPanelOpen) togglePanel("collaboration");
    const message =
      connectionStatus === "connected"
        ? "Live session active — collaborators editing this file appear here."
        : connectionStatus === "connecting"
          ? "Connecting to the live session…"
          : "Live session disconnected — reconnecting.";
    toast(message, connectionStatus === "connected" ? "success" : "info");
  }, [
    isBackendAvailable,
    activeFileId,
    isCollaborationPanelOpen,
    connectionStatus,
    togglePanel,
  ]);

  const handleGoToActiveFile = useCallback(() => {
    setOpenPanel(null);
    if (!activeFileId) {
      toast("No file is currently open.");
      return;
    }
    if (!isExplorerOpen) togglePanel("explorer");
    const editor = getActiveEditor();
    if (editor !== null) {
      editor.focus();
    } else {
      const tab = openTabs.find((t) => t.fileId === activeFileId);
      toast(`Active file: ${tab?.name ?? activeFileId}`);
    }
  }, [activeFileId, openTabs, isExplorerOpen, togglePanel]);

  // Runs a Monaco editor action from the menu bar (undo, format, etc.).
  const runEditorAction = useCallback((actionId: string, fallbackHint: string) => {
    setOpenPanel(null);
    const editor = getActiveEditor();
    if (editor === null) {
      toast(`No editor open. ${fallbackHint}`, "error");
      return;
    }
    editor.focus();
    const action = editor.getAction(actionId);
    if (action) {
      void action.run();
    } else {
      editor.trigger("menu", actionId, null);
    }
  }, []);

  // ── Nav menu definitions ───────────────────────────────────────────────────

  const navMenuContent: Record<NavItem, MenuEntry[]> = {
    File: [
      { label: "New File", icon: "note_add", onClick: handleNewFile, requiresEdit: true },
      { label: "New Folder", icon: "create_new_folder", onClick: handleNewFolder, requiresEdit: true },
      {
        label: "Open File...",
        icon: "upload_file",
        requiresEdit: true,
        onClick: () => {
          setOpenPanel(null);
          fileInputRef.current?.click();
        },
      },
      {
        label: "Import ZIP...",
        icon: "folder_zip",
        requiresEdit: true,
        onClick: () => {
          setOpenPanel(null);
          zipInputRef.current?.click();
        },
      },
      {
        // Available to every member (incl. viewers); not requiresEdit.
        label: "Export Workspace as ZIP",
        icon: "download",
        onClick: handleExportWorkspace,
        disabled: !canExport,
      },
      { label: "Save", icon: "save", onClick: handleSave, sep: true, requiresEdit: true },
      {
        label: "Run Active File",
        icon: "play_arrow",
        onClick: handleRunActiveFile,
        requiresEdit: true,
        disabled: !canRunActiveFile,
      },
      {
        label: "Version History",
        icon: "history",
        onClick: handleVersionHistory,
        disabled: !canViewHistory,
      },
      { label: "Sign out", icon: "logout", onClick: handleSignOut, sep: true, danger: true },
    ],
    Edit: [
      {
        label: "Undo",
        icon: "undo",
        requiresEdit: true,
        onClick: () => runEditorAction("undo", "Use Cmd+Z in the editor."),
      },
      {
        label: "Redo",
        icon: "redo",
        requiresEdit: true,
        onClick: () => runEditorAction("redo", "Use Shift+Cmd+Z in the editor."),
      },
      {
        label: "Format Document",
        icon: "auto_fix_high",
        requiresEdit: true,
        onClick: () =>
          runEditorAction("editor.action.formatDocument", "Use Shift+Alt+F in the editor."),
      },
      { label: "Copy Path", icon: "content_copy", onClick: handleCopyPath },
    ],
    Selection: [
      {
        label: "Select All",
        icon: "select_all",
        onClick: () =>
          runEditorAction("editor.action.selectAll", "Use Cmd+A in the editor."),
      },
      {
        label: "Copy Selection",
        icon: "content_copy",
        onClick: () =>
          runEditorAction(
            "editor.action.clipboardCopyAction",
            "Use Cmd+C to copy selection.",
          ),
      },
    ],
    View: [
      {
        label: "Toggle Explorer",
        icon: "folder_open",
        onClick: () => { togglePanel("explorer"); setOpenPanel(null); },
      },
      {
        label: "Toggle Collaboration",
        icon: "group",
        onClick: () => { togglePanel("collaboration"); setOpenPanel(null); },
      },
      {
        label: "Toggle Terminal",
        icon: "terminal",
        onClick: () => { toggleTerminal(); setOpenPanel(null); },
      },
      {
        label: "Toggle Theme",
        icon: theme === "dark" ? "light_mode" : "dark_mode",
        onClick: () => { toggleTheme(); setOpenPanel(null); },
      },
    ],
    Go: [
      {
        label: "Command Palette",
        icon: "bolt",
        onClick: () => { setOpenPanel(null); toggleCommandPalette(); },
      },
      {
        label: "Go to Workspace",
        icon: "code",
        onClick: () => { navigate("/workspace"); setOpenPanel(null); },
      },
      {
        label: "Go to Home",
        icon: "home",
        onClick: () => { navigate("/"); setOpenPanel(null); },
      },
      { label: "Go to Active File", icon: "my_location", onClick: handleGoToActiveFile },
    ],
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between meridian-crisp-border border-b bg-surface px-3"
      role="banner"
    >
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        accept=".ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.cpp,.c,.h,.html,.css,.json,.md,.yaml,.yml,.sql,.sh,.bash,.txt,.toml,.xml"
        data-testid="header-file-picker-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          e.target.value = "";
          const result = await openLocalFile(file);
          if (result.error) toast(result.error, "error");
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        accept=".zip"
        data-testid="header-zip-picker-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          e.target.value = "";
          const result = await importZip(file);
          if (result.error) toast(result.error);
        }}
      />

      {/* ── Left: wordmark + nav ────────────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 items-center gap-4">
        <MeridianWordmark />

        <div ref={navRef}>
          <nav className="hidden items-center md:flex" aria-label="Main menu">
            {/* Menu entries' onClick handlers close over the hidden file-input
                refs; the refs are read on click, not during render. */}
            {/* eslint-disable-next-line react-hooks/refs */}
            {NAV_ITEMS.map((item) => {
              const panelKey = `${item.toLowerCase()}-menu` as OpenPanel;
              const isOpen = openPanel === panelKey;
              const entries = navMenuContent[item].filter(
                    (e) => !isViewer || e.requiresEdit !== true,
                  );
              return (
                <div key={item} className="relative">
                  <button
                    type="button"
                    className={[
                      navButtonClass,
                      isOpen ? "bg-surface-container-high text-on-surface" : "",
                    ].join(" ")}
                    onClick={() => setOpenPanel(isOpen ? null : panelKey)}
                    aria-expanded={isOpen}
                    aria-haspopup="menu"
                    data-testid={item === "File" ? "top-menu-file" : undefined}
                  >
                    {item}
                  </button>
                  {isOpen ? (
                    <DropdownPanel className="left-0 w-52" role="menu">
                      {entries.map((entry) => (
                        <div key={entry.label}>
                          {entry.sep === true ? <MenuSeparator /> : null}
                          <MenuItem
                            label={entry.label}
                            icon={entry.icon}
                            onClick={entry.onClick}
                            danger={entry.danger}
                            disabled={entry.disabled}
                            role="menuitem"
                          />
                        </div>
                      ))}
                    </DropdownPanel>
                  ) : null}
                </div>
              );
            })}
          </nav>
        </div>
      </div>

      {/* ── Right: controls ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5">

        {/* Collaborator avatars */}
        <div ref={collaboratorsRef} className="relative">
          <button
            type="button"
            aria-label={`View collaborators (${collaborators.length})`}
            aria-haspopup="dialog"
            aria-expanded={openPanel === "collaborators"}
            className="flex items-center rounded px-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            onClick={() => setOpenPanel(openPanel === "collaborators" ? null : "collaborators")}
          >
            <div className="flex -space-x-2">
              {visibleCollaborators.map((c) => (
                <CollaboratorAvatar key={c.id} collaborator={c} />
              ))}
              {overflowCount > 0 ? <OverflowAvatar count={overflowCount} /> : null}
              {visibleCollaborators.length === 0 ? (
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-outline-variant text-[10px] text-on-surface-variant"
                  title="No collaborators"
                >
                  <MaterialIcon name="person_add" className="text-[13px]" aria-hidden />
                </span>
              ) : null}
            </div>
          </button>
          {openPanel === "collaborators" ? (
            <DropdownPanel className="right-0 w-64" role="dialog" aria-label="Collaborators">
              <div className="border-b meridian-crisp-border px-3 py-2">
                <span className="text-xs font-semibold text-on-surface">
                  Collaborators ({collaborators.length})
                </span>
              </div>
              {collaborators.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-3 py-4 text-center">
                  <MaterialIcon
                    name="group_add"
                    className="text-[20px] text-on-surface-variant/40"
                    aria-hidden
                  />
                  <p className="text-xs text-on-surface-variant">No collaborators yet.</p>
                  <p className="text-[10px] text-on-surface-variant/70">
                    Use <strong className="font-semibold">Share</strong> to invite someone.
                  </p>
                </div>
              ) : (
                <div className="py-1">
                  {collaborators.map((c) => (
                    <div key={c.id} className="flex items-center gap-2.5 px-3 py-2">
                      <span
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-on-primary"
                        style={{ backgroundColor: c.color }}
                      >
                        {getInitials(c.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium text-on-surface">{c.name}</span>
                          {c.isOwner ? (
                            <span className="rounded bg-primary/10 px-1 py-px text-[9px] font-semibold text-primary">
                              Owner
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[10px] text-on-surface-variant">{c.activity}</div>
                      </div>
                      <span
                        className={[
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          c.status === "active" ? "bg-primary" : "bg-outline",
                        ].join(" ")}
                        title={c.status}
                      />
                    </div>
                  ))}
                </div>
              )}
            </DropdownPanel>
          ) : null}
        </div>

        {/* Live Session */}
        <button
          type="button"
          aria-label={
            isBackendAvailable ? "Start live session" : "Live session unavailable — backend offline"
          }
          className={[headerButtonSecondary, "hidden items-center gap-1.5 sm:inline-flex"].join(" ")}
          onClick={handleLiveSession}
        >
          <MaterialIcon
            name={connectionStatus === "connected" ? "wifi" : "wifi_off"}
            className={[
              "text-[13px]",
              connectionStatus === "connected" ? "text-primary" : "text-on-surface-variant",
            ].join(" ")}
            aria-hidden
          />
          Live Session
        </button>

        {/* Share / Invite — owners only */}
        {isOwner ? <div ref={shareRef} className="relative">
          <button
            type="button"
            aria-label="Share workspace — invite collaborators"
            aria-haspopup="dialog"
            aria-expanded={openPanel === "share"}
            className={headerButtonPrimary}
            onClick={() => setOpenPanel(openPanel === "share" ? null : "share")}
            data-testid="share-button"
          >
            Share
          </button>
          {openPanel === "share" ? (
            <DropdownPanel className="right-0 w-80" role="dialog" aria-label="Share workspace" data-testid="share-dialog">
              {/* Header */}
              <div className="border-b meridian-crisp-border px-3 py-2">
                <span className="text-xs font-semibold text-on-surface">Share Workspace</span>
              </div>

              {/* Invite by email */}
              <div className="px-3 py-3">
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  Invite by Email
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSendInvite();
                    }}
                    placeholder="colleague@example.com"
                    className="min-w-0 flex-1 rounded-sm border meridian-crisp-border bg-surface-container-lowest px-2 py-1.5 text-xs text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
                    aria-label="Invite email address"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => {
                      // Hide the previous role's token while its replacement is
                      // generated. Otherwise a fast copy can grant editor access
                      // even though the UI already says "Viewer".
                      setInviteToken(null);
                      setCopyStatus("idle");
                      setInviteRole(e.target.value as InviteRole);
                    }}
                    className="shrink-0 rounded-sm border meridian-crisp-border bg-surface-container px-1.5 py-1.5 text-xs text-on-surface outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20"
                    aria-label="Invite role"
                  >
                    <option value="EDITOR">Editor</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleSendInvite()}
                    disabled={inviteStatus === "sent"}
                    aria-label="Send invite"
                    className={[
                      "shrink-0 rounded-sm px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                      inviteStatus === "sent"
                        ? "bg-primary/15 text-primary"
                        : "btn-primary",
                      "disabled:cursor-default",
                    ].join(" ")}
                  >
                    {inviteStatus === "sent" ? "Sent!" : "Invite"}
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] leading-snug text-on-surface-variant/70">
                  They must open the invite link while signed in with that email. If mail
                  can&apos;t be delivered, use the copy-link field below.
                </p>
              </div>

              {/* Copy invite link */}
              <div className="border-t meridian-crisp-border px-3 pb-3 pt-2.5">
                <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                  Or Copy Invite Link
                </label>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate rounded border meridian-crisp-border bg-surface-container-highest px-2 py-1.5 font-mono text-[10px] text-on-surface-variant" data-testid="invite-link-display">
                    {inviteLink}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    disabled={isBackendAvailable && inviteToken === null}
                    aria-label="Copy invite link"
                    data-testid="copy-invite-link"
                    className={[
                      "shrink-0 rounded px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-60",
                      copyStatus === "copied"
                        ? "bg-primary text-on-primary"
                        : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest",
                    ].join(" ")}
                  >
                    {isBackendAvailable && inviteToken === null
                      ? "Generating…"
                      : copyStatus === "copied"
                        ? "Copied!"
                        : "Copy"}
                  </button>
                </div>
                {inviteToken === null ? (
                  <p className="mt-1.5 text-[10px] text-on-surface-variant/60">
                    Connect backend to generate a persistent invite link.
                  </p>
                ) : (
                  <p className="mt-1.5 text-[10px] text-on-surface-variant/60">
                    Anyone with this link can join as{" "}
                    {inviteRole === "EDITOR" ? "an editor" : "a viewer"}. Expires in 7 days.
                  </p>
                )}
              </div>
            </DropdownPanel>
          ) : null}
        </div> : null}

        {/* Right icon cluster */}
        <div className="flex items-center gap-px border-l meridian-crisp-border pl-2">

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className={iconButtonMutedClass}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            data-testid="theme-toggle"
          >
            <MaterialIcon
              name={theme === "dark" ? "light_mode" : "dark_mode"}
              className="text-[18px]"
              aria-hidden
            />
          </button>

          {/* Notifications */}
          <div ref={notificationsRef} className="relative">
            <button
              type="button"
              onClick={() => setOpenPanel(openPanel === "notifications" ? null : "notifications")}
              className={iconButtonMutedClass}
              aria-label="Notifications"
              aria-haspopup="dialog"
              aria-expanded={openPanel === "notifications"}
            >
              <MaterialIcon name="notifications" className="text-[18px]" aria-hidden />
            </button>
            {openPanel === "notifications" ? (
              <DropdownPanel className="right-0 w-64" role="dialog" aria-label="Notifications" data-testid="notifications-panel">
                <div className="flex items-center justify-between border-b meridian-crisp-border px-3 py-2">
                  <span className="text-xs font-semibold text-on-surface">Notifications</span>
                  {notifications.length > 0 ? (
                    <button
                      type="button"
                      className="text-[10px] text-on-surface-variant transition-colors hover:text-on-surface"
                      onClick={clearNotifications}
                      aria-label="Clear all notifications"
                    >
                      Clear all
                    </button>
                  ) : null}
                </div>
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 px-3 py-5 text-center" data-testid="notifications-empty">
                    <MaterialIcon
                      name="notifications_none"
                      className="text-[20px] text-on-surface-variant/40"
                      aria-hidden
                    />
                    <p className="text-xs text-on-surface-variant">No notifications.</p>
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto py-1">
                    {notifications.map((n) => (
                      <div key={n.id} className="flex items-start gap-2.5 px-3 py-2">
                        <MaterialIcon
                          name={n.icon}
                          className="mt-0.5 shrink-0 text-[14px] text-primary"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-on-surface">{n.text}</div>
                          <div className="text-[10px] text-on-surface-variant">
                            {formatRelativeTime(n.timestamp)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </DropdownPanel>
            ) : null}
          </div>

          {/* Account */}
          <div ref={accountRef} className="relative">
            <button
              type="button"
              onClick={() => setOpenPanel(openPanel === "account" ? null : "account")}
              className={iconButtonMutedClass}
              aria-label="Account menu"
              aria-haspopup="dialog"
              aria-expanded={openPanel === "account"}
              data-testid="account-menu-button"
            >
              <MaterialIcon name="account_circle" className="text-[18px]" aria-hidden />
            </button>
            {openPanel === "account" ? (
              <DropdownPanel className="right-0 w-56" role="dialog" aria-label="Account" data-testid="account-menu">
                <div className="border-b meridian-crisp-border px-3 py-2.5">
                  {currentUser !== null ? (
                    <>
                      <div className="text-xs font-semibold text-on-surface">{currentUser.displayName}</div>
                      <div className="truncate text-[10px] text-on-surface-variant">{currentUser.email}</div>
                    </>
                  ) : (
                    <div className="text-xs text-on-surface-variant">Not signed in</div>
                  )}
                </div>
                <div className="py-1">
                  <MenuItem
                    label="Workspace"
                    icon="workspaces"
                    onClick={() => { navigate("/workspace"); setOpenPanel(null); }}
                  />
                  <MenuItem
                    label="Settings"
                    icon="settings"
                    onClick={() => { setSettingsOpen(true); setOpenPanel(null); }}
                  />
                </div>
                <MenuSeparator />
                <div className="py-1">
                  <MenuItem label="Sign out" icon="logout" onClick={handleSignOut} danger />
                </div>
              </DropdownPanel>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
