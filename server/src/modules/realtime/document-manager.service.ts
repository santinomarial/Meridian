import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { seedClientId } from '../../common/crdt/crdt-lineage';

interface DocEntry {
  doc: Y.Doc;
  // Awareness is ephemeral: cursor positions and selections are kept only in
  // memory and are never written to the database.  Document text (via Yjs
  // updates) is what gets persisted.
  awareness: awarenessProtocol.Awareness;
  // The Document.crdtGeneration this Y.Doc was built from. Persistence writes
  // carry this value so PostgreSQL can fence out stale lineages after restore.
  generation: number;
  refCount: number;
  teardownTimer?: NodeJS.Timeout;
  // Present while the initial DB load is in progress.  Concurrent acquire()
  // calls await this promise so they never receive a partially-loaded Y.Doc.
  loading?: Promise<void>;
}

@Injectable()
export class DocumentManagerService {
  private readonly docs = new Map<string, DocEntry>();
  // In-flight reload per document so concurrent restore/audit triggers share
  // one rebuild instead of racing each other.
  private readonly reloads = new Map<string, Promise<void>>();
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
      // The doc may have been swapped by a reload while we waited.
      return this.docs.get(documentId)?.doc ?? existing.doc;
    }

    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    // Register the entry before awaiting the load so concurrent acquires for
    // the same documentId share the same Y.Doc instance.
    const entry: DocEntry = { doc, awareness, generation: 0, refCount: 1 };
    this.docs.set(documentId, entry);

    // Store the loading promise so concurrent callers can await it, and
    // remove the stale entry on failure so the next acquire() can retry.
    entry.loading = this.loadFromDb(documentId, doc)
      .then((generation) => {
        entry.generation = generation;
      })
      .catch((err: unknown) => {
        this.docs.delete(documentId);
        throw err;
      })
      .finally(() => {
        entry.loading = undefined;
      });

    await entry.loading;
    // The doc may have been swapped by a reload triggered during the load.
    return this.docs.get(documentId)?.doc ?? doc;
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

  /** The CRDT generation the loaded Y.Doc belongs to, if loaded. */
  getGeneration(documentId: string): number | undefined {
    return this.docs.get(documentId)?.generation;
  }

  /** Ids of every document currently held in memory. */
  loadedDocumentIds(): string[] {
    return [...this.docs.keys()];
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

  /**
   * Rebuilds the in-memory Y.Doc from the database, replacing the current
   * instance while preserving the entry's reference count. Used after a
   * restore replaced the CRDT history with a new generation: the old Y.Doc
   * encodes a dead lineage and must be evicted, not mutated.
   *
   * No-op when the document is not loaded (a later acquire builds it fresh).
   */
  async reload(documentId: string): Promise<void> {
    const inFlight = this.reloads.get(documentId);
    if (inFlight !== undefined) return inFlight;

    const reload = this.doReload(documentId).finally(() => {
      this.reloads.delete(documentId);
    });
    this.reloads.set(documentId, reload);
    return reload;
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

  private async doReload(documentId: string): Promise<void> {
    const entry = this.docs.get(documentId);
    if (entry === undefined) return;
    // Let a concurrent initial load settle before replacing its result.
    if (entry.loading !== undefined) {
      await entry.loading.catch(() => {});
    }

    const freshDoc = new Y.Doc();
    const freshAwareness = new awarenessProtocol.Awareness(freshDoc);
    let generation: number;
    try {
      generation = await this.loadFromDb(documentId, freshDoc);
    } catch (err) {
      freshAwareness.destroy();
      freshDoc.destroy();
      throw err;
    }

    // The entry may have been torn down while we loaded.
    if (this.docs.get(documentId) !== entry) {
      freshAwareness.destroy();
      freshDoc.destroy();
      return;
    }

    const oldDoc = entry.doc;
    const oldAwareness = entry.awareness;
    entry.doc = freshDoc;
    entry.awareness = freshAwareness;
    entry.generation = generation;
    oldAwareness.destroy();
    oldDoc.destroy();
  }

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

  /**
   * Rebuilds the document text into `doc` from the current generation's
   * snapshot and delta updates. Returns the generation that was loaded.
   */
  private async loadFromDb(documentId: string, doc: Y.Doc): Promise<number> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { content: true, crdtGeneration: true },
    });
    const generation = document?.crdtGeneration ?? 0;

    // Load the most recent snapshot of this generation, if any, as the base.
    const snapshot = await this.prisma.snapshot.findFirst({
      where: { documentId, generation },
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
        generation,
        seq: { gt: snapshot?.seq ?? -1 },
      },
      orderBy: { seq: 'asc' },
    });

    for (const row of updates) {
      Y.applyUpdate(doc, row.update);
    }

    // First collaborative open of this generation: no Yjs history exists yet,
    // so seed the Y.Doc from the REST-managed content column. The seed is
    // persisted as the first update so later cold loads replay the exact same
    // CRDT items that client edits reference. The server is the only party
    // that seeds — clients must never insert initial content themselves.
    if (snapshot === null && updates.length === 0) {
      await this.seedFromContent(
        documentId,
        generation,
        document?.content ?? '',
        doc,
      );
    }

    return generation;
  }

  private async seedFromContent(
    documentId: string,
    generation: number,
    content: string,
    doc: Y.Doc,
  ): Promise<void> {
    if (content.length === 0) return;

    // Two replicas may cold-open a never-before-collaborated document at the
    // same time. A deterministic seed client id makes both initial Yjs states
    // byte-identical; createMany(skipDuplicates) then lets either replica win
    // the seq-0 insert without producing two independent copies of the text.
    doc.clientID = seedClientId(documentId, generation);
    doc.getText('content').insert(0, content);
    await this.prisma.documentUpdate.createMany({
      data: [{
        documentId,
        generation,
        seq: 0,
        update: Buffer.from(Y.encodeStateAsUpdate(doc)),
      }],
      skipDuplicates: true,
    });
  }
}
