import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentManagerService } from './document-manager.service';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

@Injectable()
export class DocumentPersistenceService {
  // ---------------------------------------------------------------------------
  // Sequence counters
  //
  // Why in-memory instead of a DB-level sequence?
  //
  // A DB sequence (or SELECT MAX(seq) + 1 inside each INSERT) requires a
  // round-trip to the database on every Yjs update.  Yjs updates are
  // generated at editing speed (dozens per second per user), so a DB
  // round-trip per update would become a bottleneck and add latency to the
  // relay path even though the seq column is only needed for ordering when
  // replaying updates to rebuild a document.
  //
  // The in-memory counter is safe because writes for the same document are
  // serialised through the per-document promise chain below.  The counter is
  // initialised on the first write by taking MAX(documentUpdate.seq,
  // snapshot.seq) from the database so we resume correctly after both a
  // normal restart and a compaction (which deletes DocumentUpdate rows).
  //
  // Limitation: this strategy is correct only for a single-server deployment.
  // Horizontal scaling requires a shared counter such as a Redis INCR or a
  // PostgreSQL sequence fetched once per connection — deferred until the Redis
  // pub/sub layer is added.
  // ---------------------------------------------------------------------------
  private readonly seqMap = new Map<string, number>();

  // Per-document write chain.  Each new write is appended to the tail of the
  // existing promise so that:
  //   1. Writes for the same document are serialised (preserving seq order).
  //   2. flushDocument / flushAll can simply await the tail promise.
  private readonly writeChain = new Map<string, Promise<void>>();

  // Tracks how many updates have been persisted since the last snapshot for
  // each document.  Resets to 0 after each successful compaction.
  private readonly updateCountSinceSnapshot = new Map<string, number>();

  private readonly snapshotEveryN: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly documentManager: DocumentManagerService,
    configService: ConfigService,
    @InjectPinoLogger(DocumentPersistenceService.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.snapshotEveryN = config.snapshotEveryNUpdates;
  }

  /**
   * Enqueues a durable write for one Yjs update.
   *
   * Returns immediately so the gateway can relay the update to peers without
   * waiting for the database.  After the write settles, compaction is
   * attempted if the per-document counter reaches the threshold.  Errors are
   * caught, logged, and swallowed so a transient DB failure never crashes the
   * gateway or disrupts live editing.
   */
  persistUpdate(documentId: string, update: Uint8Array): void {
    const previous = this.writeChain.get(documentId) ?? Promise.resolve();
    const next = previous
      .then(() => this.doWrite(documentId, update))
      .then(() =>
        // Compaction errors are caught separately so a failed compaction does
        // not prevent subsequent updates from being written.
        this.maybeCompact(documentId).catch((err: unknown) => {
          this.logger.error(
            { documentId, err },
            'Compaction failed — will retry after next batch of updates',
          );
        }),
      )
      .catch((err: unknown) => {
        this.logger.error(
          { documentId, err },
          'Failed to persist Yjs update — update may be lost on restart',
        );
      });
    this.writeChain.set(documentId, next);
  }

  /** Waits until all pending writes for one document have settled. */
  async flushDocument(documentId: string): Promise<void> {
    await (this.writeChain.get(documentId) ?? Promise.resolve());
  }

  /** Waits until all pending writes across every document have settled. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.writeChain.values()]);
  }

  // ---------------------------------------------------------------------------
  // Private — write
  // ---------------------------------------------------------------------------

  private async doWrite(documentId: string, update: Uint8Array): Promise<void> {
    const seq = await this.nextSeq(documentId);
    await this.prisma.documentUpdate.create({
      data: {
        documentId,
        update: Buffer.from(update),
        seq,
      },
    });
  }

  private async nextSeq(documentId: string): Promise<number> {
    if (!this.seqMap.has(documentId)) {
      // First write after (re)start: derive the high-water mark from both
      // tables so we resume correctly even after compaction deleted rows.
      //
      // After compaction the DocumentUpdate table may be empty (seq returns
      // null) while the Snapshot table holds the latest seq.  Taking the max
      // of both ensures new writes continue from the right sequence number
      // instead of resetting to 0, which would make them invisible to
      // reconstruction (snapshot.seq > new update.seq → filtered out).
      const [updateResult, snapshot] = await Promise.all([
        this.prisma.documentUpdate.aggregate({
          where: { documentId },
          _max: { seq: true },
        }),
        this.prisma.snapshot.findFirst({
          where: { documentId },
          orderBy: { seq: 'desc' },
          select: { seq: true },
        }),
      ]);

      const maxUpdateSeq = updateResult._max.seq ?? -1;
      const maxSnapshotSeq = snapshot?.seq ?? -1;
      const maxSeq = Math.max(maxUpdateSeq, maxSnapshotSeq);
      this.seqMap.set(documentId, maxSeq < 0 ? 0 : maxSeq + 1);
    }

    const seq = this.seqMap.get(documentId) as number; // guaranteed above
    this.seqMap.set(documentId, seq + 1);
    return seq;
  }

  // ---------------------------------------------------------------------------
  // Private — compaction
  // ---------------------------------------------------------------------------

  private async maybeCompact(documentId: string): Promise<void> {
    const count = (this.updateCountSinceSnapshot.get(documentId) ?? 0) + 1;

    if (count < this.snapshotEveryN) {
      this.updateCountSinceSnapshot.set(documentId, count);
      return;
    }

    // Reset the counter before attempting compaction so that a transient
    // failure doesn't cause every subsequent write to retry immediately.
    // The next compaction will happen after another snapshotEveryN writes.
    this.updateCountSinceSnapshot.set(documentId, 0);

    const state = this.documentManager.getState(documentId);
    if (state.length === 0) {
      // The Y.Doc was torn down between the write and the compaction — skip.
      // This is safe: the updates are already persisted and will be loaded
      // normally on the next cold start.
      this.logger.warn(
        { documentId },
        'Skipping compaction — document no longer in memory',
      );
      return;
    }

    // seqMap holds the next seq to assign; the last written seq is one less.
    const nextSeqValue = this.seqMap.get(documentId);
    if (nextSeqValue === undefined || nextSeqValue === 0) return;
    const snapshotSeq = nextSeqValue - 1;

    // Transaction safety: readers see either the full set of old DocumentUpdate
    // rows OR the new Snapshot — never a gap where the updates were already
    // deleted but the Snapshot is not yet committed.  PostgreSQL's default
    // READ COMMITTED isolation ensures that a concurrent cold-load query that
    // starts before the transaction commits will still see the old updates;
    // one that starts after will see the new snapshot and no deleted rows.
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.snapshot.create({
        data: {
          documentId,
          state: Buffer.from(state),
          seq: snapshotSeq,
        },
      });
      await tx.documentUpdate.deleteMany({
        where: { documentId, seq: { lte: snapshotSeq } },
      });
    });

    this.logger.info(
      { documentId, seq: snapshotSeq },
      'Compacted Yjs updates into snapshot',
    );
  }
}
