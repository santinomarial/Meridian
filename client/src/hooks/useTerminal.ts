import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getSocket } from "../lib/socket";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

type OutputPayload = { data: string };
type ErrorPayload = { message: string };
type ExitPayload = { code: number | null };
type StatusPayload = { status: "ready" | "running" };

export interface UseTerminalReturn {
  terminalRef: React.RefObject<HTMLDivElement>;
  start: () => void;
  stop: () => void;
  fit: () => void;
}

export function useTerminal(workspaceId: string | null): UseTerminalReturn {
  // useRef<T>(null) resolves to RefObject<T> (not MutableRefObject<T | null>),
  // which is what the JSX `ref` prop expects under @types/react 18.3.
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);

  const setTerminalStatus = useWorkspaceStore((s) => s.setTerminalStatus);
  const isTerminalOpen = useWorkspaceStore((s) => s.isTerminalOpen);

  // Initialize xterm when the container div is first rendered.
  useEffect(() => {
    const container = terminalRef.current;
    if (container === null || mountedRef.current) return;
    mountedRef.current = true;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#aeafad",
        selectionBackground: "#264f78",
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Forward keystrokes to the server.
    term.onData((data) => {
      getSocket().emit("terminal:input", { data });
    });

    return (): void => {
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      mountedRef.current = false;
    };
  }, []);

  // Re-fit when the panel becomes visible.
  useEffect(() => {
    if (isTerminalOpen) {
      // RAF ensures the DOM has painted before measuring.
      requestAnimationFrame(() => fitAddonRef.current?.fit());
    }
  }, [isTerminalOpen]);

  // Wire socket events while the workspaceId is known.
  useEffect(() => {
    if (workspaceId === null) return;

    const socket = getSocket();

    const onOutput = ({ data }: OutputPayload): void => {
      xtermRef.current?.write(data);
    };

    const onError = ({ message }: ErrorPayload): void => {
      xtermRef.current?.writeln(`\r\n\x1b[31m[Error] ${message}\x1b[0m`);
      setTerminalStatus("error");
    };

    const onExit = ({ code }: ExitPayload): void => {
      const label = code !== null ? `code ${code}` : "signal";
      xtermRef.current?.writeln(`\r\n\x1b[33m[Process exited: ${label}]\x1b[0m`);
      setTerminalStatus("idle");
    };

    const onStatus = ({ status }: StatusPayload): void => {
      setTerminalStatus(status === "running" ? "running" : "ready");
    };

    socket.on("terminal:output", onOutput);
    socket.on("terminal:error", onError);
    socket.on("terminal:exit", onExit);
    socket.on("terminal:status", onStatus);

    return (): void => {
      socket.off("terminal:output", onOutput);
      socket.off("terminal:error", onError);
      socket.off("terminal:exit", onExit);
      socket.off("terminal:status", onStatus);
    };
  }, [workspaceId, setTerminalStatus]);

  const start = useCallback((): void => {
    if (workspaceId === null) return;
    setTerminalStatus("idle");
    xtermRef.current?.clear();
    getSocket().emit("terminal:start", { workspaceId });
  }, [workspaceId, setTerminalStatus]);

  const stop = useCallback((): void => {
    getSocket().emit("terminal:stop");
    setTerminalStatus("idle");
  }, [setTerminalStatus]);

  const fit = useCallback((): void => {
    if (fitAddonRef.current === null) return;
    fitAddonRef.current.fit();
    const term = xtermRef.current;
    if (term !== null) {
      getSocket().emit("terminal:resize", {
        cols: term.cols,
        rows: term.rows,
      });
    }
  }, []);

  return { terminalRef, start, stop, fit };
}
