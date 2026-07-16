import { useEffect } from "react";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { getSocket } from "../lib/socket";
import {
  getOrCreateAwareness,
  getDocumentState,
  runWithRemoteDocumentUpdate,
} from "../lib/yjsDocs";
import { colorForUser } from "../lib/collabColors";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return null;
}

type SyncPayload = { documentId: string; message: unknown };
type UpdatePayload = { documentId: string; update: unknown };
type ChatPayload = {
  id: string;
  workspaceId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
};

export function useSessionSocket(): void {
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const setConnectionStatus = useWorkspaceStore((s) => s.setConnectionStatus);

  useEffect(() => {
    if (backendStatus !== "available") return;

    const socket = getSocket();

    const onConnect = (): void => {
      setConnectionStatus("connected");
      // Join the workspace room for workspace-wide events (chat).
      if (workspaceId !== null) {
        socket.emit("joinWorkspace", { workspaceId });
      }
    };
    const onDisconnect = (): void => setConnectionStatus("disconnected");
    const onConnectError = (): void => setConnectionStatus("disconnected");

    const onChatMessage = (payload: ChatPayload): void => {
      useWorkspaceStore.getState().addChatMessage({
        id: payload.id,
        senderId: payload.senderId,
        senderName: payload.senderName,
        senderColor: colorForUser(payload.senderId),
        text: payload.text,
        timestamp: payload.timestamp,
      });
    };

    const onYjsSync = ({ documentId, message }: SyncPayload): void => {
      const bytes = toUint8Array(message);
      if (bytes === null) return;

      const doc = getDocumentState(documentId);
      if (doc === undefined) return;
      const decoder = decoding.createDecoder(bytes);
      const responseEncoder = encoding.createEncoder();
      const messageType = runWithRemoteDocumentUpdate(documentId, () =>
        syncProtocol.readSyncMessage(
          decoder,
          responseEncoder,
          doc,
          "remote",
        ),
      );

      if (encoding.length(responseEncoder) > 0) {
        socket.emit("yjs:sync", {
          documentId,
          message: encoding.toUint8Array(responseEncoder),
        });
      }

      // The server opens the handshake with SyncStep1 (its state vector),
      // which only lets it pull OUR missing state. Reply with our own
      // SyncStep1 so the server sends back the document state we are missing
      // — without this the joining client never receives existing content.
      if (messageType === syncProtocol.messageYjsSyncStep1) {
        const step1Encoder = encoding.createEncoder();
        syncProtocol.writeSyncStep1(step1Encoder, doc);
        socket.emit("yjs:sync", {
          documentId,
          message: encoding.toUint8Array(step1Encoder),
        });
      }
    };

    const onYjsUpdate = ({ documentId, update }: UpdatePayload): void => {
      const bytes = toUint8Array(update);
      if (bytes === null) return;
      const doc = getDocumentState(documentId);
      if (doc === undefined) return;
      runWithRemoteDocumentUpdate(documentId, () => {
        Y.applyUpdate(doc, bytes, "remote");
      });
    };

    // A document was restored to an earlier version on the server. The restored
    // text arrives via the preceding yjs:update (applied above), which the
    // Monaco binding reflects in the editor. This event then reconciles the
    // dirty/save indicators so the tab is not left looking like an unsaved edit.
    const onDocumentRestored = ({ documentId }: { documentId: string }): void => {
      useWorkspaceStore.getState().markDocumentRestored(documentId);
    };

    const onAwarenessUpdate = ({ documentId, update }: UpdatePayload): void => {
      const bytes = toUint8Array(update);
      if (bytes === null) return;
      if (getDocumentState(documentId) === undefined) return;
      awarenessProtocol.applyAwarenessUpdate(
        getOrCreateAwareness(documentId),
        bytes,
        "remote",
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("yjs:sync", onYjsSync);
    socket.on("yjs:update", onYjsUpdate);
    socket.on("awareness:update", onAwarenessUpdate);
    socket.on("chat:message", onChatMessage);
    socket.on("document:restored", onDocumentRestored);

    setConnectionStatus("connecting");
    if (socket.connected) {
      // Already connected (e.g. workspaceId resolved after the socket) —
      // run the connect logic now since no "connect" event will fire.
      onConnect();
    } else {
      socket.connect();
    }

    return (): void => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("yjs:sync", onYjsSync);
      socket.off("yjs:update", onYjsUpdate);
      socket.off("awareness:update", onAwarenessUpdate);
      socket.off("chat:message", onChatMessage);
      socket.off("document:restored", onDocumentRestored);
      socket.disconnect();
      setConnectionStatus("disconnected");
    };
  }, [backendStatus, workspaceId, setConnectionStatus]);
}
