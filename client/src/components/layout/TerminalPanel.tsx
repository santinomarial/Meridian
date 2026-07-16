import { useEffect, useRef } from "react";
import { MaterialIcon } from "../ui/MaterialIcon";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useTerminal } from "../../hooks/useTerminal";
import type { ConnectionStatus, TerminalStatus, TerminalSyncStatus } from "../../types";

// xterm CSS must be imported once globally; we import it here so it is only
// bundled when the TerminalPanel is actually rendered.
import "@xterm/xterm/css/xterm.css";

type StatusTone = "idle" | "ok" | "warn" | "error";

function statusMeta(
  terminalStatus: TerminalStatus,
  connectionStatus: ConnectionStatus,
): { label: string; tone: StatusTone } {
  if (terminalStatus === "disabled") return { label: "Disabled", tone: "warn" };
  if (terminalStatus === "error") return { label: "Error", tone: "error" };
  if (connectionStatus === "disconnected") return { label: "Offline", tone: "error" };
  if (terminalStatus === "ready" || terminalStatus === "running") {
    return { label: "Connected", tone: "ok" };
  }
  if (terminalStatus === "idle") return { label: "Idle", tone: "idle" };
  return { label: "Starting…", tone: "warn" };
}

const SYNC_LABEL: Record<TerminalSyncStatus, string> = {
  synced: "Synced",
  syncing: "Syncing",
  failed: "Sync failed",
};

const TONE_DOT: Record<StatusTone, string> = {
  idle: "bg-outline-variant",
  ok: "bg-secondary",
  warn: "bg-tertiary",
  error: "bg-error",
};

const TONE_TEXT: Record<StatusTone, string> = {
  idle: "text-on-surface-variant",
  ok: "text-secondary",
  warn: "text-tertiary",
  error: "text-error",
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
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const isViewer =
    backendStatus !== "unavailable" &&
    userRole !== "OWNER" &&
    userRole !== "EDITOR";

  const { terminalRef, start, stop, fit, focus, clear } = useTerminal(workspaceId);

  useEffect(() => {
    if (!isTerminalOpen) return;
    const handler = (): void => fit();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [isTerminalOpen, fit]);

  // Auto-start for editors/owners when the panel opens (VS Code-style).
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
  const status = statusMeta(terminalStatus, connectionStatus);
  // Keep panel chrome flush with the xterm canvas (same hex as useTerminal themes).
  const terminalBackground = theme === "light" ? "#eceef3" : "#0f1219";

  return (
    <div
      className={[
        "terminal-panel flex flex-col border-t meridian-crisp-border",
        isTerminalOpen ? "" : "hidden",
      ].join(" ")}
      style={{ height: 260, background: terminalBackground }}
      data-testid="terminal-panel"
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b meridian-crisp-border bg-surface-container/90 px-3 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <MaterialIcon
              name="terminal"
              className="text-[15px] text-on-surface"
              aria-hidden
            />
            <span className="text-[12px] font-semibold tracking-wide text-on-surface">
              Terminal
            </span>
          </div>

          {workspaceName ? (
            <span
              className="hidden max-w-[10rem] truncate text-[11px] text-on-surface-variant sm:inline"
              title={`Workspace: ${workspaceName}`}
              data-testid="terminal-workspace-badge"
            >
              {workspaceName}
            </span>
          ) : null}

          <span
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium",
              "bg-surface-container-lowest/70",
              TONE_TEXT[status.tone],
            ].join(" ")}
            data-testid="terminal-status-label"
          >
            <span
              className={["h-1.5 w-1.5 rounded-full", TONE_DOT[status.tone]].join(" ")}
              aria-hidden
            />
            {status.label}
          </span>

          {terminalSyncStatus !== null && !isViewer ? (
            <span
              className={[
                "hidden text-[10px] sm:inline",
                terminalSyncStatus === "failed"
                  ? "text-error"
                  : "text-on-surface-variant/70",
              ].join(" ")}
              data-testid="terminal-sync-status"
            >
              {SYNC_LABEL[terminalSyncStatus]}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {isViewer ? (
            <span className="mr-1 text-[10px] text-on-surface-variant">
              View-only
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
              <IconButton onClick={clear} label="Clear terminal" icon="delete_sweep" />
              <span className="mx-1 h-3 w-px bg-outline-variant/60" aria-hidden />
            </>
          )}
          <IconButton onClick={toggleTerminal} label="Close terminal" icon="close" />
        </div>
      </div>

      <div
        ref={terminalRef}
        className="terminal-xterm min-h-0 flex-1 overflow-hidden px-3 py-2"
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
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      <MaterialIcon name={icon} className="text-[16px]" aria-hidden />
    </button>
  );
}
