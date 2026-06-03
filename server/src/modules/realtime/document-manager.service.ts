import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';
import { PrismaService } from '../../prisma/prisma.service';

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
  private readonly graceMs: number;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.graceMs = config.docTeardownGraceMs;
  }

  async acquire(documentId: string): Promise<Y.Doc> {
    const existing = this.docs.get(documentId);

    if (existing !== undefined) {
      // Cancel any pending teardown so the document stays alive.
      if (existing.teardownTimer !== undefined) {
        clearTimeout(existing.teardownTimer);
        existing.teardownTimer = undefined;
      }
      existing.refCount += 1;
      return existing.doc;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    // Register the entry before the async load so that concurrent acquires
    // for the same documentId get the same Y.Doc instance.
    this.docs.set(documentId, { doc, awareness, refCount: 1 });
    await this.loadFromDb(documentId, doc);
    return doc;
  }

  release(documentId: string): void {
    const entry = this.docs.get(documentId);
    if (entry === undefined) return;

    entry.refCount = Math.max(0, entry.refCount - 1);

    // When the last client leaves, schedule deferred teardown.  The grace
    // period lets late-joining clients or quick reconnects reuse the already
    // warm Y.Doc instead of rebuilding it from the database.
    if (entry.refCount === 0 && entry.teardownTimer === undefined) {
      entry.teardownTimer = setTimeout(
        () => this.teardown(documentId),
        this.graceMs,
      );
    }
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

  /** Destroys all in-memory docs and cancels pending timers. Intended for tests. */
  destroyAll(): void {
    for (const entry of this.docs.values()) {
      if (entry.teardownTimer !== undefined) {
        clearTimeout(entry.teardownTimer);
      }
      entry.awareness.destroy();
      entry.doc.destroy();
    }
    this.docs.clear();
  }

  // ---------------------------------------------------------------------------

  private teardown(documentId: string): void {
    const entry = this.docs.get(documentId);
    if (entry === undefined) return;
    // Defensive guard: skip if a concurrent acquire raced the timer.
    if (entry.refCount > 0) return;

    entry.awareness.destroy();
    entry.doc.destroy();
    this.docs.delete(documentId);
  }

  // ---------------------------------------------------------------------------
  // DB reconstruction
  // ---------------------------------------------------------------------------

  private async loadFromDb(documentId: string, doc: Y.Doc): Promise<void> {
    // Load the most recent snapshot, if any, as the base state.
    const snapshot = await this.prisma.snapshot.findFirst({
      where: { documentId },
      orderBy: { seq: 'desc' },
    });

    if (snapshot !== null) {
      Y.applyUpdate(doc, snapshot.state);
    }

    // Load only the delta updates that came after the snapshot (or all updates
    // when there is no snapshot, using seq > -1 to match every row).
    const updates = await this.prisma.documentUpdate.findMany({
      where: {
        documentId,
        seq: { gt: snapshot?.seq ?? -1 },
      },
      orderBy: { seq: 'asc' },
    });

    for (const row of updates) {
      Y.applyUpdate(doc, row.update);
    }
  }
}
