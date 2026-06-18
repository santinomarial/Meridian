import { useEffect, useRef } from "react";
import { MaterialIcon } from "../ui/MaterialIcon";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useTerminal } from "../../hooks/useTerminal";
import type { ConnectionStatus, TerminalStatus, TerminalSyncStatus } from "../../types";

// xterm CSS must be imported once globally; we import it here so it is only
// bundled when the TerminalPanel is actually rendered.
import "@xterm/xterm/css/xterm.css";

/** Human-readable connection status, VS Code style. */
function connectionLabel(
  terminalStatus: TerminalStatus,
  connectionStatus: ConnectionStatus,
): string {
  if (terminalStatus === "disabled") return "Disabled";
  if (terminalStatus === "error") return "Error";
  if (connectionStatus === "disconnected") return "Disconnected";
  if (terminalStatus === "ready" || terminalStatus === "running") return "Connected";
  return "Starting…";
}

const SYNC_LABEL: Record<TerminalSyncStatus, string> = {
  synced: "Synced",
  syncing: "Syncing…",
  failed: "Sync failed",
};

export function TerminalPanel() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);
  const isTerminalOpen = useWorkspaceStore((s) => s.isTerminalOpen);
  const terminalStatus = useWorkspaceStore((s) => s.terminalStatus);
  const terminalSyncStatus = useWorkspaceStore((s) => s.terminalSyncStatus);
  const connectionStatus = useWorkspaceStore((s) => s.connectionStatus);
  const toggleTerminal = useWorkspaceStore((s) => s.toggleTerminal);
  const theme = useWorkspaceStore((s) => s.theme);
  const userRole = useWorkspaceStore((s) => s.userRole);
  const isViewer = userRole === "VIEWER";

  const { terminalRef, start, stop, fit, focus, clear } = useTerminal(workspaceId);

  // Re-fit whenever the panel opens or the window/panel size changes.
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    if (!isTerminalOpen) return;
    const handler = (): void => fitRef.current();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [isTerminalOpen]);

  // Auto-start a shell when an editor/owner opens the panel, so the terminal is
  // immediately interactive (VS Code-style) without a manual Start click.
  // terminal:start is idempotent server-side, so reopening reattaches rather
  // than spawning a second shell. Viewers never auto-start (and are rejected
  // server-side regardless).
  const startedForOpenRef = useRef(false);
  useEffect(() => {
    if (!isTerminalOpen) {
      startedForOpenRef.current = false;
      return;
    }
    if (isViewer || workspaceId === null || startedForOpenRef.current) return;
    startedForOpenRef.current = true;
    start();
  }, [isTerminalOpen, isViewer, workspaceId, start]);

  const isRunning = terminalStatus === "running" || terminalStatus === "ready";
  const terminalBackground = theme === "light" ? "#ffffff" : "#1e1e1e";

  // Keep the panel mounted (hidden when closed) so xterm + scrollback persist
  // across open/close and keystrokes are never dropped by a remount.
  return (
    <div
      className={[
        "flex flex-col meridian-crisp-border border-t",
        isTerminalOpen ? "" : "hidden",
      ].join(" ")}
      style={{ height: 240, background: terminalBackground }}
      data-testid="terminal-panel"
    >
      {/* Title bar — uses Meridian surface tokens so it follows the app theme. */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b meridian-crisp-border bg-surface-container px-3">
        <div className="flex min-w-0 items-center gap-2">
          <MaterialIcon name="terminal" className="text-[14px] text-on-surface-variant" aria-hidden />
          <span className="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant">
            Terminal
          </span>
          {workspaceName ? (
            <span
              className="truncate rounded bg-surface-container-high px-1.5 py-0.5 text-[10px] text-on-surface-variant"
              title={`Workspace: ${workspaceName}`}
              data-testid="terminal-workspace-badge"
            >
              {workspaceName}
            </span>
          ) : null}
          <span
            className="text-[10px] text-on-surface-variant/70"
            data-testid="terminal-status-label"
          >
            {connectionLabel(terminalStatus, connectionStatus)}
          </span>
          {terminalSyncStatus !== null && !isViewer ? (
            <span
              className={[
                "text-[10px]",
                terminalSyncStatus === "failed" ? "text-error" : "text-on-surface-variant/60",
              ].join(" ")}
              data-testid="terminal-sync-status"
            >
              · {SYNC_LABEL[terminalSyncStatus]}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {isViewer ? (
            <span className="text-[10px] text-tertiary">
              View-only — terminal requires editor access
            </span>
          ) : (
            <>
              {!isRunning ? (
                <IconButton onClick={start} label="Start terminal" icon="play_arrow" />
              ) : (
                <IconButton onClick={stop} label="Stop terminal" icon="stop" />
              )}
              {isRunning ? (
                <IconButton
                  onClick={() => {
                    stop();
                    setTimeout(start, 100);
                  }}
                  label="Restart terminal"
                  icon="refresh"
                />
              ) : null}
              <IconButton onClick={clear} label="Clear terminal" icon="clear_all" />
            </>
          )}
          <IconButton onClick={toggleTerminal} label="Close terminal" icon="close" />
        </div>
      </div>

      {/* xterm.js mount point. Clicking anywhere in it focuses the terminal so
          keystrokes reach the shell. */}
      <div
        ref={terminalRef}
        className="min-h-0 flex-1 overflow-hidden px-1 py-0.5"
        data-testid="terminal-xterm"
        aria-label="Terminal"
        aria-live="off"
        onMouseUp={() => focus()}
      />
    </div>
  );
}

function IconButton({
  onClick,
  label,
  icon,
}: {
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
    >
      <MaterialIcon name={icon} className="text-[16px]" aria-hidden />
    </button>
  );
}
