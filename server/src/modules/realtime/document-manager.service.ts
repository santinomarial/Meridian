import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentPersistenceService } from './document-persistence.service';

interface DocEntry {
  doc: Y.Doc;
  // Awareness is ephemeral: cursor positions and selections are kept only in
  // memory and are never written to the database.  Document text (via Yjs
  // updates) is what gets persisted.
  awareness: awarenessProtocol.Awareness;
  refCount: number;
  teardownTimer?: NodeJS.Timeout;
  // Present while the initial DB load is in progress.  Concurrent acquire()
  // calls await this promise so they never receive a partially-loaded Y.Doc.
  loading?: Promise<void>;
}

function deterministicSeedClientId(documentId: string): number {
  const value = createHash('sha256').update(documentId).digest().readUInt32BE(0);
  return value === 0 ? 1 : value;
}

@Injectable()
export class DocumentManagerService {
  private readonly docs = new Map<string, DocEntry>();
  private readonly graceMs: number;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly persistence: DocumentPersistenceService,
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
      // Wait for the initial DB load to finish so concurrent callers never
      // receive a partially-loaded Y.Doc.
      if (existing.loading !== undefined) {
        await existing.loading;
      }
      return existing.doc;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    // Register the entry before awaiting the load so concurrent acquires for
    // the same documentId share the same Y.Doc instance.
    const entry: DocEntry = { doc, awareness, refCount: 1 };
    this.docs.set(documentId, entry);

    // Store the loading promise so concurrent callers can await it, and
    // remove the stale entry on failure so the next acquire() can retry.
    entry.loading = this.loadFromDb(documentId, doc)
      .catch((err: unknown) => {
        this.docs.delete(documentId);
        throw err;
      })
      .finally(() => {
        entry.loading = undefined;
      });

    await entry.loading;
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
    void this.persistence.releaseDocument(documentId);
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

    // First collaborative open of this document: no Yjs history exists yet,
    // so seed the Y.Doc from the REST-managed content column. The seed is
    // persisted as the first update so later cold loads replay the exact same
    // CRDT items that client edits reference. The server is the only party
    // that seeds — clients must never insert initial content themselves.
    if (snapshot === null && updates.length === 0) {
      await this.seedFromContent(documentId, doc);
    }
  }

  private async seedFromContent(documentId: string, doc: Y.Doc): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { content: true },
    });
    const content = document?.content ?? '';
    if (content.length === 0) return;

    // Two replicas may cold-open a never-before-collaborated document at the
    // same time. A deterministic seed client id makes both initial Yjs states
    // byte-identical; createMany(skipDuplicates) then lets either replica win
    // the seq-0 insert without producing two independent copies of the text.
    doc.clientID = deterministicSeedClientId(documentId);
    doc.getText('content').insert(0, content);
    await this.prisma.documentUpdate.createMany({
      data: [{
        documentId,
        seq: 0,
        update: Buffer.from(Y.encodeStateAsUpdate(doc)),
      }],
      skipDuplicates: true,
    });
  }
}
