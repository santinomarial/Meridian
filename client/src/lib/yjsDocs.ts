import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

const _docs = new Map<string, Y.Doc>();
const _awareness = new Map<string, Awareness>();
const _remoteUpdateDepth = new Map<string, number>();

export function getOrCreateDoc(documentId: string): Y.Doc {
  let doc = _docs.get(documentId);
  if (doc === undefined) {
    doc = new Y.Doc();
    _docs.set(documentId, doc);
  }
  return doc;
}

export function getOrCreateAwareness(documentId: string): Awareness {
  let awareness = _awareness.get(documentId);
  if (awareness === undefined) {
    const doc = getOrCreateDoc(documentId);
    awareness = new Awareness(doc);
    _awareness.set(documentId, awareness);
  }
  return awareness;
}

/**
 * Marks a synchronous Yjs transaction as server-originated. Monaco change
 * callbacks run inside the same transaction, so they can update displayed
 * content without falsely marking the tab as a local unsaved edit.
 */
export function runWithRemoteDocumentUpdate<T>(
  documentId: string,
  update: () => T,
): T {
  _remoteUpdateDepth.set(documentId, (_remoteUpdateDepth.get(documentId) ?? 0) + 1);
  try {
    return update();
  } finally {
    const nextDepth = (_remoteUpdateDepth.get(documentId) ?? 1) - 1;
    if (nextDepth === 0) _remoteUpdateDepth.delete(documentId);
    else _remoteUpdateDepth.set(documentId, nextDepth);
  }
}

export function isApplyingRemoteDocumentUpdate(documentId: string): boolean {
  return (_remoteUpdateDepth.get(documentId) ?? 0) > 0;
}
