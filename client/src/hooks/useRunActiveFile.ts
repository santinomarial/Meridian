import { useCallback } from "react";
import { getSocket } from "../lib/socket";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { useSaveActiveFile } from "./useSaveActiveFile";

/** File extensions Meridian can execute in the terminal. */
const RUNNABLE_EXTENSIONS = new Set(["py", "js", "ts", "sh", "go"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export interface UseRunActiveFileReturn {
  /** Saves the active file, ensures the terminal is open, and runs the file. */
  runActiveFile: () => Promise<void>;
  /** Whether running is currently possible (drives disabled UI states). */
  canRun: boolean;
  /** Why running is unavailable, when it is. */
  disabledReason?: string;
}

/** Waits until the terminal session is ready (or a short timeout elapses). */
function waitForTerminalReady(timeoutMs = 25_000): Promise<boolean> {
  const ready = (status: string): boolean => status === "ready" || status === "running";
  if (ready(useWorkspaceStore.getState().terminalStatus)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(false);
    }, timeoutMs);
    const unsub = useWorkspaceStore.subscribe((state) => {
      if (ready(state.terminalStatus)) {
        clearTimeout(timer);
        unsub();
        resolve(true);
      } else if (state.terminalStatus === "error" || state.terminalStatus === "disabled") {
        clearTimeout(timer);
        unsub();
        resolve(false);
      }
    });
  });
}

/**
 * "Run Active File" — saves the current file, makes sure the terminal is open
 * and connected, then asks the backend to run it in the workspace sandbox so
 * the command and its real output appear in the terminal.
 */
export function useRunActiveFile(): UseRunActiveFileReturn {
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const userRole = useWorkspaceStore((s) => s.userRole);
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const terminalStatus = useWorkspaceStore((s) => s.terminalStatus);
  const terminalEnabled = useWorkspaceStore((s) => s.terminalEnabled);
  const setTerminalOpen = useWorkspaceStore((s) => s.setTerminalOpen);
  const addNotification = useWorkspaceStore((s) => s.addNotification);
  const { saveActiveFile } = useSaveActiveFile();

  const isViewer = userRole !== "OWNER" && userRole !== "EDITOR";
  const activeTab = openTabs.find((t) => t.fileId === activeFileId);
  const ext = activeTab ? extensionOf(activeTab.name) : "";
  const hasBackendFile = activeFileId !== null && !activeFileId.startsWith("local-");

  let disabledReason: string | undefined;
  if (isViewer) {
    disabledReason = "Requires editor access";
  } else if (activeFileId === null) {
    disabledReason = "Open a file first";
  } else if (!terminalEnabled || terminalStatus === "disabled" || backendStatus !== "available" || !hasBackendFile) {
    disabledReason = "Terminal is disabled";
  } else if (!RUNNABLE_EXTENSIONS.has(ext)) {
    disabledReason = "This file type is not executable";
  }

  const canRun = disabledReason === undefined;

  const runActiveFile = useCallback(async (): Promise<void> => {
    const state = useWorkspaceStore.getState();
    const id = state.activeFileId;
    const wsId = state.workspaceId;
    if (
      id === null ||
      wsId === null ||
      id.startsWith("local-") ||
      (state.userRole !== "OWNER" && state.userRole !== "EDITOR") ||
      state.backendStatus !== "available"
      || !state.terminalEnabled
    ) {
      return;
    }

    // 1. Save the file if it has unsaved edits (server-side save also syncs the
    //    sandbox), so the terminal runs the latest content.
    const tab = state.openTabs.find((t) => t.fileId === id);
    if (tab?.dirty) {
      const saved = await saveActiveFile();
      if (!saved) {
        addNotification({
          icon: "error",
          text: `Could not run ${tab.name} because its latest changes were not saved`,
        });
        return;
      }
    }

    // 2. Make sure the terminal panel is open (this auto-starts a session).
    if (!state.isTerminalOpen) setTerminalOpen(true);
    else if (state.terminalStatus === "idle" || state.terminalStatus === "error") {
      useWorkspaceStore.getState().setTerminalStatus("starting");
      getSocket().emit("terminal:start", { workspaceId: wsId });
    }

    // A worker may take time to allocate. Never dispatch into a pending or
    // different workspace session when the user navigates during startup.
    if (!await waitForTerminalReady()) {
      addNotification({ icon: "error", text: "Terminal did not become ready. Reconnect it and run the file again." });
      return;
    }
    const current = useWorkspaceStore.getState();
    if (current.workspaceId !== wsId || current.currentUser?.id !== state.currentUser?.id) return;
    getSocket().emit("terminal:run-file", { workspaceId: wsId, documentId: id });

    addNotification({ icon: "play_arrow", text: `Running ${tab?.name ?? "file"}` });
  }, [saveActiveFile, setTerminalOpen, addNotification]);

  return { runActiveFile, canRun, disabledReason };
}
