import { useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { CodeEditor } from "../components/editor/CodeEditor";
import { EditorTabs } from "../components/editor/EditorTabs";
import { ActivityBar } from "../components/layout/ActivityBar";
import { Breadcrumb } from "../components/layout/Breadcrumb";
import { BottomPanel } from "../components/layout/BottomPanel";
import { CollaborationPanel } from "../components/layout/CollaborationPanel";
import { FileExplorer } from "../components/layout/FileExplorer";
import { Header } from "../components/layout/Header";
import { PanelOverlay } from "../components/layout/PanelOverlay";
import { StatusBar } from "../components/layout/StatusBar";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { useEscapeClose } from "../hooks/useEscapeClose";
import { useWorkspaceReady } from "../hooks/useWorkspaceReady";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
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
  const isBottomPanelOpen = useWorkspaceStore((state) => state.isBottomPanelOpen);
  const togglePanel = useWorkspaceStore((state) => state.togglePanel);
  const closeAllOverlays = useWorkspaceStore((state) => state.closeAllOverlays);

  const isWorkspaceReady = useWorkspaceReady();

  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) {
      useWorkspaceStore.setState({
        isExplorerOpen: false,
        isCollaborationPanelOpen: false,
      });
    }
  }, []);

  const hasOpenOverlay =
    isCompact &&
    (isExplorerOpen || isCollaborationPanelOpen || isBottomPanelOpen);

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
    >
      <Header />
      <Breadcrumb />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar />

        {!isCompact && isExplorerOpen ? (
          <FileExplorer isLoading={!isWorkspaceReady} mode="inline" />
        ) : null}

        <main
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest lg:meridian-crisp-border lg:border-x"
          id="main-content"
        >
          <EditorTabs />
          <CodeEditor workspaceTheme={workspaceTheme} />
          {!isCompact && <BottomPanel mode="inline" />}
        </main>

        {!isCompact ? (
          <CollaborationPanel isLoading={!isWorkspaceReady} mode="inline" />
        ) : null}
      </div>

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

      {isCompact && isBottomPanelOpen ? (
        <PanelOverlay
          side="bottom"
          label="Bottom panel"
          onClose={() => closePanel("bottom")}
        >
          <BottomPanel
            mode="overlay"
            onClose={() => closePanel("bottom")}
          />
        </PanelOverlay>
      ) : null}
    </div>
  );
}
