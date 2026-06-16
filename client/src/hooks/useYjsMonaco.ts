import { useEffect } from "react";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import * as awarenessProtocol from "y-protocols/awareness";
import type { editor } from "monaco-editor";
import { getSocket } from "../lib/socket";
import { getOrCreateAwareness, getOrCreateDoc } from "../lib/yjsDocs";
import { colorForUser } from "../lib/collabColors";
import {
  collaboratorsFromAwareness,
  syncRemoteSelectionStyles,
} from "../lib/awarenessPresence";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export function useYjsMonaco(
  monacoEditor: editor.IStandaloneCodeEditor | null,
  documentId: string | null,
  backendAvailable: boolean,
): void {
  const currentUser = useWorkspaceStore((s) => s.currentUser);

  useEffect(() => {
    if (!monacoEditor || !documentId || !backendAvailable) return;
    // Local-only ids (e.g. a file created while the backend was briefly
    // unreachable) have no server document, so joining would be rejected as
    // unauthorized. Skip realtime sync until the file exists on the backend.
    if (documentId.startsWith("local-")) return;

    const socket = getSocket();
    const doc = getOrCreateDoc(documentId);
    const ytext = doc.getText("content");
    const model = monacoEditor.getModel();
    if (model === null) return;

    // NOTE: the Y.Text is intentionally NOT pre-populated from store content.
    // The server seeds the canonical Y.Doc from the DB and the join handshake
    // delivers it; a local insert here would create divergent CRDT items per
    // client (duplicate text, updates that never converge).

    const awareness = getOrCreateAwareness(documentId);
    const binding = new MonacoBinding(ytext, model, new Set([monacoEditor]), awareness);

    // Identify ourselves so other clients can render our cursor with a name
    // tag and list us in their presence panel.
    if (currentUser !== null) {
      awareness.setLocalStateField("user", {
        id: currentUser.id,
        name: currentUser.displayName,
        color: colorForUser(currentUser.id),
      });
    }

    // Send local Y.Doc updates to the server, batched: fast typing produces a
    // burst of small updates which would trip the server's per-socket message
    // rate limit (dropped CRDT updates desync the doc permanently). Merging
    // them into one update every flush interval keeps the rate low and safe.
    const UPDATE_FLUSH_MS = 50;
    let pendingUpdates: Uint8Array[] = [];
    let updateFlushTimer: number | null = null;

    const flushUpdates = (): void => {
      updateFlushTimer = null;
      if (pendingUpdates.length === 0) return;
      const merged =
        pendingUpdates.length === 1 ? pendingUpdates[0]! : Y.mergeUpdates(pendingUpdates);
      pendingUpdates = [];
      socket.emit("yjs:update", { documentId, update: merged });
    };

    const handleUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === "remote") return;
      pendingUpdates.push(update);
      updateFlushTimer ??= window.setTimeout(flushUpdates, UPDATE_FLUSH_MS);
    };
    doc.on("update", handleUpdate);

    // Relay local awareness changes (cursor moves, selections, identity) to
    // the server, debounced for the same rate-limit reason. Awareness is
    // ephemeral state — only the latest value matters, so coalescing is safe.
    const AWARENESS_FLUSH_MS = 80;
    const dirtyAwarenessClients = new Set<number>();
    let awarenessFlushTimer: number | null = null;

    const flushAwareness = (): void => {
      awarenessFlushTimer = null;
      if (dirtyAwarenessClients.size === 0) return;
      const clients = [...dirtyAwarenessClients];
      dirtyAwarenessClients.clear();
      socket.emit("awareness:update", {
        documentId,
        update: awarenessProtocol.encodeAwarenessUpdate(awareness, clients),
      });
    };

    const handleAwarenessUpdate = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ): void => {
      if (origin === "remote") return;
      for (const id of [...changes.added, ...changes.updated, ...changes.removed]) {
        dirtyAwarenessClients.add(id);
      }
      if (dirtyAwarenessClients.size === 0) return;
      awarenessFlushTimer ??= window.setTimeout(flushAwareness, AWARENESS_FLUSH_MS);
    };
    awareness.on("update", handleAwarenessUpdate);

    // Project awareness into UI state: collaborator list + cursor styles.
    const syncPresence = (): void => {
      const localUserId = useWorkspaceStore.getState().currentUser?.id ?? null;
      useWorkspaceStore
        .getState()
        .setCollaborators(collaboratorsFromAwareness(awareness, localUserId));
      syncRemoteSelectionStyles(awareness);
    };
    awareness.on("change", syncPresence);
    syncPresence();

    // Join the document room.
    const join = (): void => { socket.emit("joinDocument", { documentId }); };
    if (socket.connected) {
      join();
    } else {
      socket.once("connect", join);
    }

    return (): void => {
      socket.off("connect", join);
      doc.off("update", handleUpdate);
      awareness.off("change", syncPresence);
      // Announce our departure before detaching the relay so other clients
      // drop our cursor immediately.
      awareness.setLocalState(null);
      awareness.off("update", handleAwarenessUpdate);
      // Flush anything still queued so no edits are lost when switching files.
      if (updateFlushTimer !== null) window.clearTimeout(updateFlushTimer);
      flushUpdates();
      if (awarenessFlushTimer !== null) window.clearTimeout(awarenessFlushTimer);
      flushAwareness();
      binding.destroy();
      if (socket.connected) {
        socket.emit("leaveDocument", { documentId });
      }
      useWorkspaceStore.getState().setCollaborators([]);
    };
  }, [monacoEditor, documentId, backendAvailable, currentUser]);
}
