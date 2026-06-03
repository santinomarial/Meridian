import { useEffect } from "react";
import { MonacoBinding } from "y-monaco";
import type { editor } from "monaco-editor";
import { getSocket } from "../lib/socket";
import { getOrCreateAwareness, getOrCreateDoc } from "../lib/yjsDocs";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

export function useYjsMonaco(
  monacoEditor: editor.IStandaloneCodeEditor | null,
  documentId: string | null,
  backendAvailable: boolean,
): void {
  useEffect(() => {
    if (!monacoEditor || !documentId || !backendAvailable) return;

    const socket = getSocket();
    const doc = getOrCreateDoc(documentId);
    const ytext = doc.getText("content");
    const model = monacoEditor.getModel();
    if (model === null) return;

    // Pre-populate Y.Text from store content to avoid flash on MonacoBinding mount.
    // Both client and server loaded from the same DB row, so this insert will be
    // a no-op after server sync (identical CRDT states merge cleanly).
    if (ytext.length === 0) {
      const storeContent =
        useWorkspaceStore.getState().editorContentByFileId[documentId] ?? "";
      if (storeContent.length > 0) {
        doc.transact(() => {
          ytext.insert(0, storeContent);
        }, "prefill");
      }
    }

    const awareness = getOrCreateAwareness(documentId);
    const binding = new MonacoBinding(ytext, model, new Set([monacoEditor]), awareness);

    // Send local Y.Doc updates to the server (skip remote and prefill origins).
    const handleUpdate = (update: Uint8Array, origin: unknown): void => {
      if (origin === "remote" || origin === "prefill") return;
      socket.emit("yjs:update", { documentId, update });
    };
    doc.on("update", handleUpdate);

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
      binding.destroy();
      if (socket.connected) {
        socket.emit("leaveDocument", { documentId });
      }
    };
  }, [monacoEditor, documentId, backendAvailable]);
}
