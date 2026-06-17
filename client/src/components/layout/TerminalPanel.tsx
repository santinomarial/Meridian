import { useEffect, useRef } from "react";
import { MaterialIcon } from "../ui/MaterialIcon";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { useTerminal } from "../../hooks/useTerminal";

// xterm CSS must be imported once globally; we import it here so it is only
// bundled when the TerminalPanel is actually rendered.
import "@xterm/xterm/css/xterm.css";

const STATUS_LABEL: Record<string, string> = {
  idle: "Ready to start",
  ready: "Terminal ready",
  running: "Running",
  error: "Error",
  disabled: "Terminal disabled on this server",
};

export function TerminalPanel() {
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const isTerminalOpen = useWorkspaceStore((s) => s.isTerminalOpen);
  const terminalStatus = useWorkspaceStore((s) => s.terminalStatus);
  const toggleTerminal = useWorkspaceStore((s) => s.toggleTerminal);
  const userRole = useWorkspaceStore((s) => s.userRole);
  const isViewer = userRole === "VIEWER";

  const { terminalRef, start, stop, fit } = useTerminal(workspaceId);

  // Re-fit whenever the panel opens or the window resizes.
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    if (!isTerminalOpen) return;
    const handler = (): void => fitRef.current();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [isTerminalOpen]);

  if (!isTerminalOpen) return null;

  const isRunning = terminalStatus === "running" || terminalStatus === "ready";

  return (
    <div
      className="flex flex-col meridian-crisp-border border-t bg-[#1e1e1e]"
      style={{ height: 240 }}
      data-testid="terminal-panel"
    >
      {/* Title bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div className="flex items-center gap-2">
          <MaterialIcon name="terminal" className="text-[14px] text-white/60" aria-hidden />
          <span className="text-[11px] font-medium uppercase tracking-wider text-white/60">
            Terminal
          </span>
          {terminalStatus !== "idle" ? (
            <span className="text-[10px] text-white/40">
              — {STATUS_LABEL[terminalStatus] ?? terminalStatus}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {isViewer ? (
            <span className="text-[10px] text-yellow-400/80">
              View-only — terminal requires editor access
            </span>
          ) : (
            <>
              {!isRunning ? (
                <button
                  type="button"
                  onClick={start}
                  aria-label="Start terminal"
                  title="Start terminal"
                  className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <MaterialIcon name="play_arrow" className="text-[16px]" aria-hidden />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Stop terminal"
                  title="Stop terminal"
                  className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <MaterialIcon name="stop" className="text-[16px]" aria-hidden />
                </button>
              )}
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => { stop(); setTimeout(start, 100); }}
                  aria-label="Restart terminal"
                  title="Restart terminal"
                  className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
                >
                  <MaterialIcon name="refresh" className="text-[16px]" aria-hidden />
                </button>
              ) : null}
            </>
          )}
          <button
            type="button"
            onClick={toggleTerminal}
            aria-label="Close terminal"
            title="Close terminal"
            className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <MaterialIcon name="close" className="text-[16px]" aria-hidden />
          </button>
        </div>
      </div>

      {/* xterm.js mount point */}
      <div
        ref={terminalRef}
        className="min-h-0 flex-1 overflow-hidden px-1 py-0.5"
        data-testid="terminal-xterm"
        aria-label="Terminal"
        aria-live="off"
      />
    </div>
  );
}
