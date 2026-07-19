/**
 * Coordinates editor-local Yjs batching with explicit save checkpoints.
 *
 * Monaco updates are deliberately batched before they enter the durable
 * outbound queue. A save must force that in-memory batch into the queue before
 * it waits for server acknowledgements, otherwise a fast Cmd+S can checkpoint
 * the previous document state.
 */

export type DocumentUpdateFlusher = () => Promise<void>;

const flushers = new Map<string, DocumentUpdateFlusher>();

/**
 * Registers the active editor binding's flusher. The returned cleanup is
 * identity-safe: tearing down an old binding cannot unregister its replacement.
 */
export function registerDocumentUpdateFlusher(
  documentId: string,
  flusher: DocumentUpdateFlusher,
): () => void {
  flushers.set(documentId, flusher);
  return () => {
    if (flushers.get(documentId) === flusher) {
      flushers.delete(documentId);
    }
  };
}

/**
 * Flushes an active editor binding. Returns false while the binding handshake
 * is not ready yet so callers can wait briefly instead of checkpointing stale
 * content.
 */
export async function flushDocumentUpdates(documentId: string): Promise<boolean> {
  const flusher = flushers.get(documentId);
  if (flusher === undefined) return false;
  await flusher();
  return true;
}
