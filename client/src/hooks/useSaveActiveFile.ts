import { useCallback } from "react";
import { ApiError, updateDocument } from "../lib/api";
import { toast } from "../components/ui/Toast";
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
    activeFileId !== null &&
    !activeFileId.startsWith("local-") &&
    backendStatus === "available" &&
    (userRole === "OWNER" || userRole === "EDITOR");

  const saveActiveFile = useCallback(async (): Promise<boolean> => {
    // Read fresh state at call time so a stale closure can't save old content.
    const state = useWorkspaceStore.getState();
    const id = state.activeFileId;
    if (
      id === null ||
      id.startsWith("local-") ||
      state.backendStatus !== "available" ||
      (state.userRole !== "OWNER" && state.userRole !== "EDITOR")
    ) {
      return false;
    }

    const content = state.editorContentByFileId[id] ?? "";
    const tabName = state.openTabs.find((t) => t.fileId === id)?.name ?? "file";

    state.setSaveStatus("saving");
    try {
      await updateDocument(id, { content });
      const latest = useWorkspaceStore.getState();
      const contentStillMatches = latest.editorContentByFileId[id] === content;
      if (contentStillMatches) latest.clearTabDirty(id);
      if (latest.activeFileId === id) {
        latest.setSaveStatus(contentStillMatches ? "saved" : "unsaved");
      }
      state.addNotification({ icon: "save", text: `Saved ${tabName}` });
      return true;
    } catch (err) {
      if (useWorkspaceStore.getState().activeFileId === id) {
        state.setSaveStatus("error");
      }
      if (err instanceof ApiError && err.status === 401) {
        // Session expired mid-session — say so plainly instead of a silent
        // failed-save state. Local edits are kept so nothing is lost.
        toast("Your session has expired. Please log in again.", "error");
      }
      return false;
    }
  }, []);

  return { saveActiveFile, canSaveActiveFile };
}
