import { useEffect } from "react";
import type { editor } from "monaco-editor";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import { getSocket } from "../lib/socket";
import {
  acquireDocumentState,
  getOrCreateAwareness,
  releaseDocumentState,
  runWithRemoteDocumentUpdate,
} from "../lib/yjsDocs";
import {
  ackYjsUpdate,
  decodeUpdateBase64,
  enqueueYjsUpdate,
  listPendingYjsUpdates,
} from "../lib/yjsOutboundQueue";
import { colorForUser } from "../lib/collabColors";
import { registerDocumentUpdateFlusher } from "../lib/yjsUpdateFlush";
import {
  collaboratorsFromAwareness,
  syncRemoteSelectionStyles,
} from "../lib/awarenessPresence";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

type SyncPayload = { documentId: string; message: unknown };
type JoinedPayload = { documentId: string };
type AckPayload = { documentId: string; updateId: string };

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

function newUpdateId(): string {
  return crypto.randomUUID();
}

export function useYjsMonaco(
  monacoEditor: editor.IStandaloneCodeEditor | null,
  documentId: string | null,
  backendAvailable: boolean,
): void {
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  // Bumped by document:restored / local restore so this effect tears down the
  // dead CRDT lineage and re-joins the new generation.
  const resyncEpoch = useWorkspaceStore((s) =>
    documentId !== null ? (s.documentResyncEpoch[documentId] ?? 0) : 0,
  );

  useEffect(() => {
    if (!monacoEditor || !documentId || !backendAvailable) return;
    // Local-only ids have no server document, so joining would be rejected.
    if (documentId.startsWith("local-")) return;

    const model = monacoEditor.getModel();
    if (model === null) return;

    const socket = getSocket();
    const doc = acquireDocumentState(documentId);
    let disposed = false;
    let setupTimer: number | null = null;
    let teardownBinding: (() => void) | null = null;
    let flushQueuedChanges: (() => void) | null = null;
    let resendPending: (() => void) | null = null;

    const setupBinding = (): void => {
      setupTimer = null;
      if (disposed || teardownBinding !== null || model.isDisposed()) return;

      const ytext = doc.getText("content");
      const awareness = getOrCreateAwareness(documentId);

      // Batch fast local edits to stay below the WebSocket rate limiter.
      const UPDATE_FLUSH_MS = 50;
      let pendingUpdates: Uint8Array[] = [];
      let updateFlushTimer: number | null = null;
      let activeFlush: Promise<void> | null = null;

      const emitDurableUpdate = (update: Uint8Array, updateId: string): void => {
        socket.emit("yjs:update", { documentId, updateId, update });
      };

      const flushUpdates = (): Promise<void> => {
        if (updateFlushTimer !== null) {
          window.clearTimeout(updateFlushTimer);
          updateFlushTimer = null;
        }

        // A caller arriving during a flush also drains edits collected while
        // that IndexedDB transaction was in flight.
        if (activeFlush !== null) {
          return activeFlush.then(() => flushUpdates());
        }
        if (pendingUpdates.length === 0) return Promise.resolve();

        const updates = pendingUpdates;
        pendingUpdates = [];
        const merged =
          updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates);
        const updateId = newUpdateId();

        // Enqueue even while disconnected. Re-join resends the durable entry;
        // a tab switch or teardown must never discard the in-memory batch.
        activeFlush = enqueueYjsUpdate(documentId, updateId, merged)
          .then(() => {
            if (!disposed && socket.connected) {
              emitDurableUpdate(merged, updateId);
            }
          })
          .catch((error: unknown) => {
            // IndexedDB can be unavailable in restricted browser contexts.
            // Preserve the existing live fallback, but reject the explicit
            // save so it cannot claim a durable checkpoint without evidence.
            if (!disposed && socket.connected) {
              emitDurableUpdate(merged, updateId);
            }
            throw error;
          })
          .finally(() => {
            activeFlush = null;
            if (!disposed && pendingUpdates.length > 0) {
              updateFlushTimer ??= window.setTimeout(() => {
                void flushUpdates().catch(() => undefined);
              }, UPDATE_FLUSH_MS);
            }
          });

        return activeFlush;
      };

      const handleUpdate = (update: Uint8Array, origin: unknown): void => {
        if (origin === "remote") return;
        pendingUpdates.push(update);
        updateFlushTimer ??= window.setTimeout(() => {
          void flushUpdates().catch(() => undefined);
        }, UPDATE_FLUSH_MS);
      };
      doc.on("update", handleUpdate);
      const unregisterUpdateFlusher = registerDocumentUpdateFlusher(
        documentId,
        flushUpdates,
      );

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
        void flushUpdates().catch(() => undefined);
        flushAwareness();
      };

      resendPending = (): void => {
        void listPendingYjsUpdates(documentId).then((pending) => {
          if (disposed || !socket.connected) return;
          for (const entry of pending) {
            emitDurableUpdate(decodeUpdateBase64(entry.updateBase64), entry.updateId);
          }
        });
      };

      teardownBinding = (): void => {
        unregisterUpdateFlusher();
        doc.off("update", handleUpdate);
        awareness.off("change", syncPresence);

        // Announce departure while the relay is still attached.
        awareness.setLocalState(null);

        if (updateFlushTimer !== null) window.clearTimeout(updateFlushTimer);
        void flushUpdates().catch(() => undefined);
        if (awarenessFlushTimer !== null) window.clearTimeout(awarenessFlushTimer);
        flushAwareness();
        awareness.off("update", handleAwarenessUpdate);

        // y-monaco also destroys itself from Monaco's onWillDispose callback.
        if (!model.isDisposed()) binding.destroy();
        flushQueuedChanges = null;
        resendPending = null;
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
      if (payload.documentId !== documentId) return;
      flushQueuedChanges?.();
      resendPending?.();
    };

    const onAck = (payload: AckPayload): void => {
      if (payload.documentId !== documentId) return;
      void ackYjsUpdate(payload.documentId, payload.updateId);
    };

    socket.on("connect", join);
    socket.on("joinedDocument", onJoinedDocument);
    socket.on("yjs:sync", onYjsSync);
    socket.on("yjs:ack", onAck);
    if (socket.connected) join();

    return (): void => {
      disposed = true;
      socket.off("connect", join);
      socket.off("joinedDocument", onJoinedDocument);
      socket.off("yjs:sync", onYjsSync);
      socket.off("yjs:ack", onAck);
      if (setupTimer !== null) window.clearTimeout(setupTimer);
      teardownBinding?.();
      if (socket.connected) socket.emit("leaveDocument", { documentId });
      releaseDocumentState(documentId);
      useWorkspaceStore.getState().setCollaborators([]);
    };
  }, [monacoEditor, documentId, backendAvailable, currentUser, resyncEpoch]);
}
