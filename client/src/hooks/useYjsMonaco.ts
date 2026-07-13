import { useEffect } from "react";
import type { editor } from "monaco-editor";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import { getSocket } from "../lib/socket";
import {
  getOrCreateAwareness,
  getOrCreateDoc,
  runWithRemoteDocumentUpdate,
} from "../lib/yjsDocs";
import { colorForUser } from "../lib/collabColors";
import {
  collaboratorsFromAwareness,
  syncRemoteSelectionStyles,
} from "../lib/awarenessPresence";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

type SyncPayload = { documentId: string; message: unknown };
type JoinedPayload = { documentId: string };

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return null;
}

function isSyncStep2(message: unknown): boolean {
  const bytes = toUint8Array(message);
  if (bytes === null) return false;
  try {
    return (
      decoding.readVarUint(decoding.createDecoder(bytes)) ===
      syncProtocol.messageYjsSyncStep2
    );
  } catch {
    return false;
  }
}

export function useYjsMonaco(
  monacoEditor: editor.IStandaloneCodeEditor | null,
  documentId: string | null,
  backendAvailable: boolean,
): void {
  const currentUser = useWorkspaceStore((s) => s.currentUser);

  useEffect(() => {
    if (!monacoEditor || !documentId || !backendAvailable) return;
    // Local-only ids have no server document, so joining would be rejected.
    if (documentId.startsWith("local-")) return;

    const model = monacoEditor.getModel();
    if (model === null) return;

    const socket = getSocket();
    const doc = getOrCreateDoc(documentId);
    let disposed = false;
    let setupTimer: number | null = null;
    let teardownBinding: (() => void) | null = null;
    let flushQueuedChanges: (() => void) | null = null;

    const setupBinding = (): void => {
      setupTimer = null;
      if (disposed || teardownBinding !== null || model.isDisposed()) return;

      const ytext = doc.getText("content");
      const awareness = getOrCreateAwareness(documentId);

      // Batch fast local edits to stay below the WebSocket rate limiter.
      const UPDATE_FLUSH_MS = 50;
      let pendingUpdates: Uint8Array[] = [];
      let updateFlushTimer: number | null = null;

      const flushUpdates = (): void => {
        updateFlushTimer = null;
        if (!socket.connected || pendingUpdates.length === 0) return;
        const merged =
          pendingUpdates.length === 1
            ? pendingUpdates[0]!
            : Y.mergeUpdates(pendingUpdates);
        pendingUpdates = [];
        socket.emit("yjs:update", { documentId, update: merged });
      };

      const handleUpdate = (update: Uint8Array, origin: unknown): void => {
        if (origin === "remote") return;
        pendingUpdates.push(update);
        if (socket.connected) {
          updateFlushTimer ??= window.setTimeout(flushUpdates, UPDATE_FLUSH_MS);
        }
      };
      doc.on("update", handleUpdate);

      // Awareness is ephemeral, so only the latest coalesced state matters.
      const AWARENESS_FLUSH_MS = 80;
      const dirtyAwarenessClients = new Set<number>();
      let awarenessFlushTimer: number | null = null;

      const flushAwareness = (): void => {
        awarenessFlushTimer = null;
        if (!socket.connected || dirtyAwarenessClients.size === 0) return;
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
        if (socket.connected && dirtyAwarenessClients.size > 0) {
          awarenessFlushTimer ??= window.setTimeout(
            flushAwareness,
            AWARENESS_FLUSH_MS,
          );
        }
      };
      awareness.on("update", handleAwarenessUpdate);

      const syncPresence = (): void => {
        const { currentUser: user, memberRoles } = useWorkspaceStore.getState();
        useWorkspaceStore
          .getState()
          .setCollaborators(
            collaboratorsFromAwareness(
              awareness,
              user?.id ?? null,
              memberRoles,
            ),
          );
        syncRemoteSelectionStyles(awareness);
      };
      awareness.on("change", syncPresence);

      // Binding an empty client Y.Doc immediately would blank the REST-loaded
      // editor before the server handshake arrives. We create the binding only
      // after SyncStep2 and mark its initial reconciliation as remote.
      const binding = runWithRemoteDocumentUpdate(
        documentId,
        () => new MonacoBinding(ytext, model, new Set([monacoEditor]), awareness),
      );

      // Register the awareness relay before setting identity so the very first
      // presence update is sent without waiting for a cursor movement.
      if (currentUser !== null) {
        awareness.setLocalStateField("user", {
          id: currentUser.id,
          name: currentUser.displayName,
          color: colorForUser(currentUser.id),
        });
      }
      syncPresence();

      flushQueuedChanges = (): void => {
        flushUpdates();
        flushAwareness();
      };

      teardownBinding = (): void => {
        doc.off("update", handleUpdate);
        awareness.off("change", syncPresence);

        // Announce departure while the relay is still attached.
        awareness.setLocalState(null);

        if (updateFlushTimer !== null) window.clearTimeout(updateFlushTimer);
        flushUpdates();
        if (awarenessFlushTimer !== null) window.clearTimeout(awarenessFlushTimer);
        flushAwareness();
        awareness.off("update", handleAwarenessUpdate);

        // y-monaco also destroys itself from Monaco's onWillDispose callback.
        if (!model.isDisposed()) binding.destroy();
        flushQueuedChanges = null;
        useWorkspaceStore.getState().setCollaborators([]);
      };
    };

    const onYjsSync = (payload: SyncPayload): void => {
      if (payload.documentId !== documentId || !isSyncStep2(payload.message)) return;
      // Let useSessionSocket apply the Step2 update before binding Monaco,
      // regardless of Socket.IO listener registration order.
      setupTimer ??= window.setTimeout(setupBinding, 0);
    };

    const join = (): void => {
      socket.emit("joinDocument", { documentId });
    };

    const onJoinedDocument = (payload: JoinedPayload): void => {
      if (payload.documentId === documentId) flushQueuedChanges?.();
    };

    socket.on("connect", join);
    socket.on("joinedDocument", onJoinedDocument);
    socket.on("yjs:sync", onYjsSync);
    if (socket.connected) join();

    return (): void => {
      disposed = true;
      socket.off("connect", join);
      socket.off("joinedDocument", onJoinedDocument);
      socket.off("yjs:sync", onYjsSync);
      if (setupTimer !== null) window.clearTimeout(setupTimer);
      teardownBinding?.();
      if (socket.connected) socket.emit("leaveDocument", { documentId });
      useWorkspaceStore.getState().setCollaborators([]);
    };
  }, [monacoEditor, documentId, backendAvailable, currentUser]);
}
