import { useEffect, useRef, useCallback } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getSocket } from "../lib/socket";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import type { WorkspaceTheme } from "../types";

type OutputPayload = { data: string };
type ErrorPayload = { message: string };
type ExitPayload = { code: number | null };
type StatusPayload = { status: "ready" | "running" };
type SyncPayload = { status: "synced" | "syncing" | "failed" };

// Readable xterm palettes aligned with Meridian surface tokens.
const DARK_TERMINAL_THEME: ITheme = {
  background: "#0f1219",
  foreground: "#e8eaf2",
  cursor: "#a5b4fc",
  cursorAccent: "#0f1219",
  selectionBackground: "#2a3350",
  selectionForeground: "#e8eaf2",
  black: "#1a1f2b",
  red: "#fca5a5",
  green: "#5eead4",
  yellow: "#fdba74",
  blue: "#93c5fd",
  magenta: "#c4b5fd",
  cyan: "#67e8f9",
  white: "#e8eaf2",
  brightBlack: "#6b7280",
  brightRed: "#fecaca",
  brightGreen: "#99f6e4",
  brightYellow: "#fed7aa",
  brightBlue: "#bfdbfe",
  brightMagenta: "#ddd6fe",
  brightCyan: "#a5f3fc",
  brightWhite: "#ffffff",
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#eceef3",
  foreground: "#3a4150",
  cursor: "#4f46e5",
  cursorAccent: "#eceef3",
  selectionBackground: "#c7d2fe",
  selectionForeground: "#3a4150",
  black: "#3a4150",
  red: "#dc2626",
  green: "#0d9488",
  yellow: "#c2410c",
  blue: "#2563eb",
  magenta: "#7c3aed",
  cyan: "#0891b2",
  white: "#e0e3ea",
  brightBlack: "#848c9c",
  brightRed: "#ef4444",
  brightGreen: "#14b8a6",
  brightYellow: "#ea580c",
  brightBlue: "#3b82f6",
  brightMagenta: "#8b5cf6",
  brightCyan: "#06b6d4",
  brightWhite: "#3a4150",
};

function themeFor(appTheme: WorkspaceTheme): ITheme {
  return appTheme === "light" ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}

export interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement>;
  start: () => void;
  stop: () => void;
  fit: () => void;
  focus: () => void;
  clear: () => void;
}

export function useTerminal(workspaceId: string | null): UseTerminalReturn {
  // useRef<T>(null) resolves to RefObject<T> (not MutableRefObject<T | null>),
  // which is what the JSX `ref` prop expects under @types/react 18.3.
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const setTerminalStatus = useWorkspaceStore((s) => s.setTerminalStatus);
  const setTerminalSyncStatus = useWorkspaceStore((s) => s.setTerminalSyncStatus);
  const isTerminalOpen = useWorkspaceStore((s) => s.isTerminalOpen);
  const appTheme = useWorkspaceStore((s) => s.theme);

  const focus = useCallback((): void => {
    xtermRef.current?.focus();
  }, []);

  const clear = useCallback((): void => {
    xtermRef.current?.clear();
  }, []);

  const fit = useCallback((): void => {
    if (fitAddonRef.current === null || xtermRef.current === null) return;
    try {
      fitAddonRef.current.fit();
    } catch {
      // Container not laid out yet — a later fit() will succeed.
      return;
    }
    const term = xtermRef.current;
    getSocket().emit("terminal:resize", { cols: term.cols, rows: term.rows });
  }, []);

  // Lazily create xterm the first time the panel is shown, then re-fit and
  // focus on every open. Creating it only while visible guarantees the
  // container has real dimensions so FitAddon measures correctly. The instance
  // persists across open/close (we never recreate it on theme/status changes),
  // so scrollback survives and keystrokes are never lost to a remount.
  useEffect(() => {
    if (!isTerminalOpen) return;
    const container = terminalRef.current;
    if (container === null) return;

    if (xtermRef.current === null) {
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        cursorWidth: 2,
        fontFamily: '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        lineHeight: 1.4,
        letterSpacing: 0,
        theme: themeFor(useWorkspaceStore.getState().theme),
        // The PTY owns echo and newline translation — send raw keystrokes.
        convertEol: false,
        scrollback: 5_000,
        smoothScrollDuration: 0,
        allowTransparency: false,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      // Forward every keystroke to the server PTY's stdin.
      term.onData((data) => {
        getSocket().emit("terminal:input", { data });
      });

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;
    }

    // After the panel has painted, size the terminal to the container and
    // give it focus so the user can type immediately.
    const raf = requestAnimationFrame(() => {
      fit();
      focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [isTerminalOpen, fit, focus]);

  // Keep the terminal palette in sync with the app theme live, without
  // recreating the terminal (scrollback and session are preserved).
  useEffect(() => {
    if (xtermRef.current !== null) {
      xtermRef.current.options.theme = themeFor(appTheme);
    }
  }, [appTheme]);

  // Dispose xterm only when the hook itself unmounts (workspace teardown).
  useEffect(() => {
    return () => {
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Wire socket events while the workspaceId is known.
  useEffect(() => {
    if (workspaceId === null) return;

    const socket = getSocket();

    const onOutput = ({ data }: OutputPayload): void => {
      xtermRef.current?.write(data);
    };

    const onError = ({ message }: ErrorPayload): void => {
      xtermRef.current?.writeln(`\r\n\x1b[31m[Error] ${message}\x1b[0m`);
      setTerminalStatus(
        /terminal (?:feature )?is disabled/i.test(message) ? "disabled" : "error",
      );
    };

    const onExit = ({ code }: ExitPayload): void => {
      const label = code !== null ? `code ${code}` : "signal";
      xtermRef.current?.writeln(`\r\n\x1b[33m[Process exited: ${label}]\x1b[0m`);
      setTerminalStatus("idle");
    };

    const onStatus = ({ status }: StatusPayload): void => {
      setTerminalStatus(status === "running" ? "running" : "ready");
      // The shell is live — make sure keystrokes land in it.
      focus();
    };

    const onSync = ({ status }: SyncPayload): void => {
      setTerminalSyncStatus(status);
    };

    socket.on("terminal:output", onOutput);
    socket.on("terminal:error", onError);
    socket.on("terminal:exit", onExit);
    socket.on("terminal:status", onStatus);
    socket.on("terminal:sync", onSync);

    return (): void => {
      socket.off("terminal:output", onOutput);
      socket.off("terminal:error", onError);
      socket.off("terminal:exit", onExit);
      socket.off("terminal:status", onStatus);
      socket.off("terminal:sync", onSync);
    };
  }, [workspaceId, setTerminalStatus, setTerminalSyncStatus, focus]);

  const start = useCallback((): void => {
    if (workspaceId === null) return;
    getSocket().emit("terminal:start", { workspaceId });
    focus();
  }, [workspaceId, focus]);

  const stop = useCallback((): void => {
    getSocket().emit("terminal:stop");
    setTerminalStatus("idle");
  }, [setTerminalStatus]);

  return { terminalRef, start, stop, fit, focus, clear };
}
