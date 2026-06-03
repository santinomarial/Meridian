import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

const _docs = new Map<string, Y.Doc>();
const _awareness = new Map<string, Awareness>();

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
