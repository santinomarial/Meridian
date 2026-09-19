import { CODE_FONT_FAMILY } from "../constants/typography";
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
  background: "#0a0a0a",
  foreground: "#ffffff",
  cursor: "#ffffff",
  cursorAccent: "#0a0a0a",
  selectionBackground: "#55212b",
  selectionForeground: "#ffffff",
  black: "#171717",
  red: "#ec7f90",
  green: "#ffffff",
  yellow: "#b3b3b3",
  blue: "#b3b3b3",
  magenta: "#ec7f90",
  cyan: "#b3b3b3",
  white: "#e5e5e5",
  brightBlack: "#858585",
  brightRed: "#ec7f90",
  brightGreen: "#ffffff",
  brightYellow: "#ffffff",
  brightBlue: "#ffffff",
  brightMagenta: "#ec7f90",
  brightCyan: "#ffffff",
  brightWhite: "#ffffff",
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#111111",
  cursor: "#a51c30",
  cursorAccent: "#ffffff",
  selectionBackground: "#eed2d7",
  selectionForeground: "#111111",
  black: "#171717",
  red: "#a51c30",
  green: "#111111",
  yellow: "#525252",
  blue: "#525252",
  magenta: "#a51c30",
  cyan: "#525252",
  white: "#e5e5e5",
  brightBlack: "#858585",
  brightRed: "#a51c30",
  brightGreen: "#111111",
  brightYellow: "#111111",
  brightBlue: "#111111",
  brightMagenta: "#a51c30",
  brightCyan: "#111111",
  brightWhite: "#111111",
};

function themeFor(appTheme: WorkspaceTheme): ITheme {
  return appTheme === "light" ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
}

export interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  start: () => void;
  stop: () => void;
  fit: () => void;
  focus: () => void;
  clear: () => void;
}

export function useTerminal(workspaceId: string | null): UseTerminalReturn {
  // The nullable initial value matches the JSX ref lifecycle before mount and
  // after unmount.
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
        fontFamily: CODE_FONT_FAMILY,
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
    if (workspaceId === null || !useWorkspaceStore.getState().terminalEnabled) return;

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
    if (workspaceId === null || !useWorkspaceStore.getState().terminalEnabled) return;
    getSocket().emit("terminal:start", { workspaceId });
    focus();
  }, [workspaceId, focus]);

  const stop = useCallback((): void => {
    getSocket().emit("terminal:stop");
    setTerminalStatus("idle");
  }, [setTerminalStatus]);

  return { terminalRef, start, stop, fit, focus, clear };
}
