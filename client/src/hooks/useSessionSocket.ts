import { useEffect } from "react";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { getSocket } from "../lib/socket";
import { getOrCreateAwareness, getOrCreateDoc } from "../lib/yjsDocs";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return null;
}

type SyncPayload = { documentId: string; message: unknown };
type UpdatePayload = { documentId: string; update: unknown };

export function useSessionSocket(): void {
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const setConnectionStatus = useWorkspaceStore((s) => s.setConnectionStatus);

  useEffect(() => {
    if (backendStatus !== "available") return;

    const socket = getSocket();

    const onConnect = (): void => setConnectionStatus("connected");
    const onDisconnect = (): void => setConnectionStatus("disconnected");
    const onConnectError = (): void => setConnectionStatus("disconnected");

    const onYjsSync = ({ documentId, message }: SyncPayload): void => {
      const bytes = toUint8Array(message);
      if (bytes === null) return;

      const doc = getOrCreateDoc(documentId);
      const decoder = decoding.createDecoder(bytes);
      const responseEncoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, responseEncoder, doc, "remote");

      if (encoding.length(responseEncoder) > 0) {
        socket.emit("yjs:sync", {
          documentId,
          message: encoding.toUint8Array(responseEncoder),
        });
      }
    };

    const onYjsUpdate = ({ documentId, update }: UpdatePayload): void => {
      const bytes = toUint8Array(update);
      if (bytes === null) return;
      Y.applyUpdate(getOrCreateDoc(documentId), bytes, "remote");
    };

    const onAwarenessUpdate = ({ documentId, update }: UpdatePayload): void => {
      const bytes = toUint8Array(update);
      if (bytes === null) return;
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

    setConnectionStatus("connecting");
    socket.connect();

    return (): void => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("yjs:sync", onYjsSync);
      socket.off("yjs:update", onYjsUpdate);
      socket.off("awareness:update", onAwarenessUpdate);
      socket.disconnect();
      setConnectionStatus("disconnected");
    };
  }, [backendStatus, setConnectionStatus]);
}
