import { useCallback } from "react";
import { updateDocument } from "../lib/api";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export interface UseSaveActiveFileReturn {
  /**
   * Persists the active file's current content to the backend.
   * Resolves to `true` on success, `false` when the save was not attempted
   * (no active file / viewer / backend unavailable) or the request failed.
   * Updates save status, clears the tab's dirty flag, and emits the canonical
   * "Saved <name>" notification on success.
   */
  saveActiveFile: () => Promise<boolean>;
  /** Whether a save can currently be performed (drives disabled UI states). */
  canSaveActiveFile: boolean;
}

/**
 * Single source of truth for "save the active document". Used by the Cmd+S
 * handler, the File menu Save action, and the command palette so all three
 * share identical, correct behavior instead of re-implementing it.
 */
export function useSaveActiveFile(): UseSaveActiveFileReturn {
  const activeFileId = useWorkspaceStore((s) => s.activeFileId);
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const userRole = useWorkspaceStore((s) => s.userRole);

  const canSaveActiveFile =
    activeFileId !== null && backendStatus === "available" && userRole !== "VIEWER";

  const saveActiveFile = useCallback(async (): Promise<boolean> => {
    // Read fresh state at call time so a stale closure can't save old content.
    const state = useWorkspaceStore.getState();
    const id = state.activeFileId;
    if (
      id === null ||
      state.backendStatus !== "available" ||
      state.userRole === "VIEWER"
    ) {
      return false;
    }

    const content = state.editorContentByFileId[id] ?? "";
    const tabName = state.openTabs.find((t) => t.fileId === id)?.name ?? "file";

    state.setSaveStatus("saving");
    try {
      await updateDocument(id, { content });
      state.setSaveStatus("saved");
      state.clearTabDirty(id);
      state.addNotification({ icon: "save", text: `Saved ${tabName}` });
      return true;
    } catch {
      state.setSaveStatus("error");
      return false;
    }
  }, []);

  return { saveActiveFile, canSaveActiveFile };
}
