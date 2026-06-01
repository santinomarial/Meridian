import { Injectable } from '@nestjs/common';
import * as Y from 'yjs';

interface DocEntry {
  doc: Y.Doc;
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
    this.docs.set(documentId, { doc, refCount: 1 });
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
}
