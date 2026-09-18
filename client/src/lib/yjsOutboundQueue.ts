/**
 * Durable outbound queue for unacked Yjs updates.
 *
 * Entries are written to IndexedDB before the WebSocket emit and removed only
 * after the server's post-commit `yjs:ack`. On reconnect / re-join the client
 * resends every pending entry with the same updateId so the server can
 * deduplicate via (documentId, generation, updateId).
 */

const DB_NAME = "meridian-yjs-outbound";
const DB_VERSION = 2;
const CONFLICTS = "conflicts";
const STORE = "pending";

export type QueuedYjsUpdate = {
  /** Composite key: `${documentId}:${updateId}` */
  id: string;
  documentId: string;
  updateId: string;
  /** Missing only on legacy entries, which must never be replayed blindly. */
  generation?: number;
  /** Base64-encoded Yjs update bytes */
  updateBase64: string;
  enqueuedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONFLICTS)) {
        db.createObjectStore(CONFLICTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("documentId", "documentId", { unique: false });
      }
    };
  });
}

function queueId(documentId: string, updateId: string): string {
  return `${documentId}:${updateId}`;
}

export function encodeUpdateBase64(update: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < update.byteLength; i++) {
    binary += String.fromCharCode(update[i]!);
  }
  return btoa(binary);
}

export function decodeUpdateBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function enqueueYjsUpdate(
  documentId: string,
  updateId: string,
  update: Uint8Array,
  generation: number,
): Promise<void> {
  const db = await openDb();
  try {
    const entry: QueuedYjsUpdate = {
      id: queueId(documentId, updateId),
      documentId,
      updateId,
      updateBase64: encodeUpdateBase64(update),
      enqueuedAt: Date.now(),
      generation,
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("enqueue failed"));
    });
  } finally {
    db.close();
  }
}

export async function ackYjsUpdate(
  documentId: string,
  updateId: string,
): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(queueId(documentId, updateId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("ack dequeue failed"));
    });
  } finally {
    db.close();
  }
}

export async function listPendingYjsUpdates(
  documentId: string,
): Promise<QueuedYjsUpdate[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const index = tx.objectStore(STORE).index("documentId");
      const request = index.getAll(documentId);
      request.onsuccess = () => {
        const rows = (request.result as QueuedYjsUpdate[]).slice();
        rows.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
        resolve(rows);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("list pending failed"));
    });
  } finally {
    db.close();
  }
}

/** Test helper — clears every pending entry (all documents). */
export async function clearYjsOutboundQueue(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("clear failed"));
    });
  } finally {
    db.close();
  }
}

/** Preserve incompatible edits separately; they must not block future saves. */
export async function quarantineYjsUpdate(entry: QueuedYjsUpdate): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, CONFLICTS], "readwrite");
      tx.objectStore(CONFLICTS).put(entry);
      tx.objectStore(STORE).delete(entry.id);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Recovery archive failed"));
    });
  } finally {
    db.close();
  }
}

export async function listRecoveryUpdates(): Promise<QueuedYjsUpdate[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(CONFLICTS, "readonly").objectStore(CONFLICTS).getAll();
      request.onsuccess = () => resolve(request.result as QueuedYjsUpdate[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
