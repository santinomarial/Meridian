import { useCallback } from "react";
import { ApiError, checkpointDocument } from "../lib/api";
import { listPendingYjsUpdates } from "../lib/yjsOutboundQueue";
import { flushDocumentUpdates } from "../lib/yjsUpdateFlush";
import { toast } from "../components/ui/Toast";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export interface UseSaveActiveFileReturn {
  /**
   * Checkpoints the active file's durable collaborative text on the server.
   * Resolves to `true` on success, `false` when the save was not attempted
   * (no active file / viewer / backend unavailable) or the request failed.
   * Updates save status, clears the tab's dirty flag, and emits the canonical
   * "Saved <name>" notification on success.
   */
  saveActiveFile: () => Promise<boolean>;
  /** Whether a save can currently be performed (drives disabled UI states). */
  canSaveActiveFile: boolean;
}

const PENDING_ACK_WAIT_MS = 2_000;
const PENDING_ACK_POLL_MS = 50;
const FLUSHER_READY_WAIT_MS = 2_000;
const FLUSHER_READY_POLL_MS = 20;

async function flushEditorUpdates(documentId: string): Promise<void> {
  const deadline = Date.now() + FLUSHER_READY_WAIT_MS;
  while (Date.now() < deadline) {
    if (await flushDocumentUpdates(documentId)) return;
    await new Promise((resolve) => setTimeout(resolve, FLUSHER_READY_POLL_MS));
  }
  throw new Error("Collaborative editor binding was not ready before save");
}

/**
 * Waits briefly for the IndexedDB outbound queue to drain so the server
 * checkpoint includes recently emitted updates that have not yet been acked.
 */
async function waitForPendingAcks(documentId: string): Promise<void> {
  const deadline = Date.now() + PENDING_ACK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const pending = await listPendingYjsUpdates(documentId);
      if (pending.length === 0) return;
    } catch (error: unknown) {
      throw new Error("Could not verify the collaborative update queue", {
        cause: error,
      });
    }
    await new Promise((r) => setTimeout(r, PENDING_ACK_POLL_MS));
  }
  throw new Error("Collaborative updates were not acknowledged before save");
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
    // Read fresh state at call time so a stale closure can't save the wrong tab.
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

    const tabName = state.openTabs.find((t) => t.fileId === id)?.name ?? "file";
    const contentBefore = state.editorContentByFileId[id] ?? "";

    state.setSaveStatus("saving");
    try {
      await flushEditorUpdates(id);
      await waitForPendingAcks(id);
      const result = await checkpointDocument(id);
      const latest = useWorkspaceStore.getState();
      // Align the editor mirror with the checkpoint without flipping dirty.
      if ((latest.editorContentByFileId[id] ?? "") === contentBefore) {
        latest.applyRemoteFileContent(id, result.content);
      }
      const after = useWorkspaceStore.getState();
      const contentStillMatches =
        (after.editorContentByFileId[id] ?? "") === result.content;
      if (contentStillMatches) after.clearTabDirty(id);
      if (after.activeFileId === id) {
        after.setSaveStatus(contentStillMatches ? "saved" : "unsaved");
      }
      state.addNotification({
        icon: contentStillMatches ? "save" : "edit_note",
        text: contentStillMatches
          ? `Saved ${tabName}`
          : `Newer edits in ${tabName} remain unsaved`,
      });
      return contentStillMatches;
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
