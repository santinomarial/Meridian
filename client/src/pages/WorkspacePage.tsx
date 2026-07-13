import { useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { CodeEditor } from "../components/editor/CodeEditor";
import { EditorTabs } from "../components/editor/EditorTabs";
import { ActivityBar } from "../components/layout/ActivityBar";
import { Breadcrumb } from "../components/layout/Breadcrumb";
import { CollaborationPanel } from "../components/layout/CollaborationPanel";
import { FileExplorer } from "../components/layout/FileExplorer";
import { Header } from "../components/layout/Header";
import { PanelOverlay } from "../components/layout/PanelOverlay";
import { SettingsDialog } from "../components/layout/SettingsDialog";
import { VersionHistoryDialog } from "../components/layout/VersionHistoryDialog";
import { CommandPalette } from "../components/layout/CommandPalette";
import { StatusBar } from "../components/layout/StatusBar";
import { useBackendWorkspace } from "../hooks/useBackendWorkspace";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { useSaveActiveFile } from "../hooks/useSaveActiveFile";
import { useSessionSocket } from "../hooks/useSessionSocket";
import { useWorkspaceReady } from "../hooks/useWorkspaceReady";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { TerminalPanel } from "../components/layout/TerminalPanel";
import type { PanelKey } from "../types";

export function WorkspacePage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const breakpoint = useBreakpoint();
  const isCompact = breakpoint !== "desktop";

  const workspaceTheme = useWorkspaceStore((state) => state.theme);
  const isExplorerOpen = useWorkspaceStore((state) => state.isExplorerOpen);
  const isCollaborationPanelOpen = useWorkspaceStore(
    (state) => state.isCollaborationPanelOpen,
  );
  const togglePanel = useWorkspaceStore((state) => state.togglePanel);
  const closeAllOverlays = useWorkspaceStore((state) => state.closeAllOverlays);
  const backendStatus = useWorkspaceStore((state) => state.backendStatus);
  const userRole = useWorkspaceStore((state) => state.userRole);
  const isReadOnly =
    backendStatus !== "unavailable" &&
    userRole !== "OWNER" &&
    userRole !== "EDITOR";

  const { saveActiveFile } = useSaveActiveFile();

  const isWorkspaceReady = useWorkspaceReady();

  // Load workspace from backend (mock fallback on failure)
  useBackendWorkspace();

  // Manage Socket.IO connection lifecycle
  useSessionSocket();

  // Drawers start closed on every compact layout. Opening one later is
  // exclusive, so tablet users never get two modal overlays at once.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1024px)").matches) {
      useWorkspaceStore.setState({
        isExplorerOpen: false,
        isCollaborationPanelOpen: false,
      });
    }
  }, []);

  // Cmd+S / Ctrl+S — save active document. The hook handles the no-op cases
  // (viewer, no active file, backend unavailable) and the canonical save flow.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "s") return;
      e.preventDefault();
      void saveActiveFile();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveActiveFile]);

  // Cmd+K / Ctrl+K — toggle the command palette. Runs in the capture phase so
  // it fires before Monaco/xterm key handling and is honored even when the
  // editor or terminal is focused. Only the K combo is intercepted, so other
  // shortcuts (including Cmd+S) are untouched.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      e.stopPropagation();
      useWorkspaceStore.getState().toggleCommandPalette();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const hasOpenOverlay = isCompact && (isExplorerOpen || isCollaborationPanelOpen);

  useEscapeClose(hasOpenOverlay, closeAllOverlays);

  const closePanel = useCallback(
    (panel: PanelKey) => {
      togglePanel(panel);
    },
    [togglePanel],
  );

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-surface-container-lowest"
      data-session-id={sessionId}
      data-testid="workspace-root"
      data-backend-status={backendStatus}
    >
      <Header />
      <Breadcrumb />

      {backendStatus === "unavailable" ? (
        <div
          role="status"
          className="flex items-center gap-2 bg-surface-container-high px-4 py-1.5 text-[11px] text-on-surface-variant"
          data-testid="backend-unavailable-banner"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-outline" aria-hidden />
          Backend unavailable — using local mock workspace.
        </div>
      ) : null}

      {isReadOnly && backendStatus === "available" ? (
        <div
          role="status"
          className="flex items-center gap-2 bg-tertiary/10 px-4 py-1.5 text-[11px] text-tertiary"
          data-testid="viewer-readonly-banner"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-tertiary" aria-hidden />
          {userRole === "VIEWER"
            ? "You have view-only access to this workspace."
            : "Editing is unavailable because your permissions could not be verified."}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar />

        {!isCompact && isExplorerOpen ? (
          <FileExplorer isLoading={!isWorkspaceReady} mode="inline" readOnly={isReadOnly} />
        ) : null}

        <main
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest lg:meridian-crisp-border lg:border-x"
          id="main-content"
        >
          <EditorTabs />
          <CodeEditor workspaceTheme={workspaceTheme} />
        </main>

        {!isCompact && isCollaborationPanelOpen ? (
          <CollaborationPanel isLoading={!isWorkspaceReady} mode="inline" />
        ) : null}
      </div>

      <TerminalPanel />

      <StatusBar />

      {isCompact && isExplorerOpen ? (
        <PanelOverlay
          side="left"
          label="Explorer"
          onClose={() => closePanel("explorer")}
        >
          <FileExplorer
            isLoading={!isWorkspaceReady}
            mode="drawer"
            onClose={() => closePanel("explorer")}
            readOnly={isReadOnly}
          />
        </PanelOverlay>
      ) : null}

      {isCompact && isCollaborationPanelOpen ? (
        <PanelOverlay
          side="right"
          label="Collaboration"
          onClose={() => closePanel("collaboration")}
        >
          <CollaborationPanel
            isLoading={!isWorkspaceReady}
            mode="drawer"
            onClose={() => closePanel("collaboration")}
          />
        </PanelOverlay>
      ) : null}

      <SettingsDialog />
      <VersionHistoryDialog />
      <CommandPalette />
    </div>
  );
}
