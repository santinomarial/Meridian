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
import { StatusBar } from "../components/layout/StatusBar";
import { useBackendWorkspace } from "../hooks/useBackendWorkspace";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { useSessionSocket } from "../hooks/useSessionSocket";
import { useWorkspaceReady } from "../hooks/useWorkspaceReady";
import { updateDocument } from "../lib/api";
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
  const activeFileId = useWorkspaceStore((state) => state.activeFileId);
  const editorContentByFileId = useWorkspaceStore((state) => state.editorContentByFileId);
  const setSaveStatus = useWorkspaceStore((state) => state.setSaveStatus);
  const clearTabDirty = useWorkspaceStore((state) => state.clearTabDirty);
  const addNotification = useWorkspaceStore((state) => state.addNotification);

  const userRole = useWorkspaceStore((state) => state.userRole);
  const isViewer = userRole === "VIEWER";

  const isWorkspaceReady = useWorkspaceReady();

  // Load workspace from backend (mock fallback on failure)
  useBackendWorkspace();

  // Manage Socket.IO connection lifecycle
  useSessionSocket();

  // Close panels on small screens on first mount
  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) {
      useWorkspaceStore.setState({
        isExplorerOpen: false,
        isCollaborationPanelOpen: false,
      });
    }
  }, []);

  // Cmd+S / Ctrl+S — save active document to backend when available
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "s") return;
      e.preventDefault();

      if (isViewer || backendStatus !== "available" || activeFileId === null) return;

      const content = editorContentByFileId[activeFileId] ?? "";
      setSaveStatus("saving");

      const tabName =
        useWorkspaceStore.getState().openTabs.find((t) => t.fileId === activeFileId)?.name ??
        "file";

      updateDocument(activeFileId, { content })
        .then(() => {
          setSaveStatus("saved");
          clearTabDirty(activeFileId);
          addNotification({ icon: "save", text: `Saved ${tabName}` });
        })
        .catch(() => {
          setSaveStatus("error");
        });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isViewer,
    backendStatus,
    activeFileId,
    editorContentByFileId,
    setSaveStatus,
    clearTabDirty,
    addNotification,
  ]);

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

      {isViewer ? (
        <div
          role="status"
          className="flex items-center gap-2 bg-tertiary/10 px-4 py-1.5 text-[11px] text-tertiary"
          data-testid="viewer-readonly-banner"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-tertiary" aria-hidden />
          You have view-only access to this workspace.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar />

        {!isCompact && isExplorerOpen ? (
          <FileExplorer isLoading={!isWorkspaceReady} mode="inline" readOnly={isViewer} />
        ) : null}

        <main
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest lg:meridian-crisp-border lg:border-x"
          id="main-content"
        >
          <EditorTabs />
          <CodeEditor workspaceTheme={workspaceTheme} />
        </main>

        {!isCompact ? (
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
            readOnly={isViewer}
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
    </div>
  );
}
