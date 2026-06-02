import { Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

interface DocEntry {
  doc: Y.Doc;
  // Awareness is ephemeral: cursor positions and selections are kept only in
  // memory and are never written to the database.  Document text (via Yjs
  // updates) is what gets persisted.
  awareness: awarenessProtocol.Awareness;
  refCount: number;
  teardownTimer?: NodeJS.Timeout;
}

@Injectable()
export class DocumentManagerService {
  private readonly docs = new Map<string, DocEntry>();

  acquire(documentId: string): Y.Doc {
    const existing = this.docs.get(documentId);

    if (existing !== undefined) {
      if (existing.teardownTimer !== undefined) {
        clearTimeout(existing.teardownTimer);
        existing.teardownTimer = undefined;
      }
      existing.refCount += 1;
      return existing.doc;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    this.docs.set(documentId, { doc, awareness, refCount: 1 });
    return doc;
  }

  release(documentId: string): void {
    const entry = this.docs.get(documentId);
    if (entry === undefined) return;

    entry.refCount = Math.max(0, entry.refCount - 1);
    // Teardown deferred: doc is kept alive until explicitly destroyed.
  }

  getDoc(documentId: string): Y.Doc | undefined {
    return this.docs.get(documentId)?.doc;
  }

  getAwareness(documentId: string): awarenessProtocol.Awareness | undefined {
    return this.docs.get(documentId)?.awareness;
  }

  getState(documentId: string): Uint8Array {
    const entry = this.docs.get(documentId);
    if (entry === undefined) return new Uint8Array(0);
    return Y.encodeStateAsUpdate(entry.doc);
  }

  applyUpdate(documentId: string, update: Uint8Array): void {
    const entry = this.docs.get(documentId);
    if (entry === undefined) return;
    Y.applyUpdate(entry.doc, update);
  }

  hasDocument(documentId: string): boolean {
    return this.docs.has(documentId);
  }

  refCount(documentId: string): number {
    return this.docs.get(documentId)?.refCount ?? 0;
  }

  size(): number {
    return this.docs.size;
  }

  /** Destroys all in-memory docs and awareness instances. Intended for tests. */
  destroyAll(): void {
    for (const entry of this.docs.values()) {
      entry.awareness.destroy();
      entry.doc.destroy();
    }
    this.docs.clear();
  }
}
