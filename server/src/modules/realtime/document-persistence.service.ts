import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

/** Redis key holding the shared sequence counter for a document. */
function seqKey(documentId: string): string {
  return `meridian:doc:${documentId}:seq`;
}

@Injectable()
export class DocumentPersistenceService implements OnApplicationShutdown {
  // ---------------------------------------------------------------------------
  // Sequence counters
  //
  // The `seq` column only needs to be globally unique and monotonic per
  // document so updates can be ordered/filtered against snapshots when
  // rebuilding a document (Yjs updates are themselves commutative/idempotent).
  //
  // Allocation strategy:
  //   - When Redis is available, seq is allocated with an atomic Redis counter
  //     (seeded once from the DB high-water mark). This is correct across
  //     multiple server instances — two replicas persisting the same document
  //     never collide.
  //   - When Redis is unavailable, it falls back to a per-process in-memory
  //     counter (also seeded from the DB high-water mark). This matches the
  //     original single-instance behavior and avoids a DB round-trip per
  //     keystroke, but is only collision-free within one process.
  //
  // Writes for the same document are serialised through the per-document
  // promise chain below, so an allocated seq is always written before the next
  // is allocated — which keeps the in-memory fallback self-correcting (the DB
  // high-water mark stays current). See docs/scaling.md.
  // ---------------------------------------------------------------------------
  private readonly seqMap = new Map<string, number>();

  // Documents whose Redis seq counter this process has already seeded, so the
  // hot path can use a plain INCR instead of re-seeding from the DB each write.
  private readonly redisSeeded = new Set<string>();

  // Per-document write chain.  Each new write is appended to the tail of the
  // existing promise so that:
  //   1. Writes for the same document are serialised (preserving seq order).
  //   2. flushDocument / flushAll can simply await the tail promise.
  private readonly writeChain = new Map<string, Promise<void>>();

  // Tracks how many updates have been persisted since the last snapshot for
  // each document.  Resets to 0 after each successful compaction.
  private readonly updateCountSinceSnapshot = new Map<string, number>();

  // Last sequence that this process successfully wrote for each document.
  // Unlike seqMap, this is populated for both Redis and in-memory allocation.
  // It gives compaction a conservative durable cutoff without assuming that a
  // Redis-allocated update from another instance is already in local memory.
  private readonly lastPersistedSeq = new Map<string, number>();

  private readonly snapshotEveryN: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    configService: ConfigService,
    @InjectPinoLogger(DocumentPersistenceService.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.snapshotEveryN = config.snapshotEveryNUpdates;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flushAll();
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

  /**
   * Resets the persisted Yjs history for a document — used by version restore.
   *
   * Restore makes the plain-text `content` column authoritative again, so the
   * old CRDT history (which still encodes the pre-restore text) must be
   * discarded or a cold load would reconstruct the wrong document.
   *
   *  - When `fullState` is provided (the document is live in memory), it is
   *    written as the sole Snapshot at seq 0 so cold loads rebuild exactly the
   *    restored state, and the seq counter resumes at 1.
   *  - When `fullState` is null (the document is not loaded), all rows are
   *    deleted so the next collaborative open re-seeds from `content` via
   *    DocumentManager.seedFromContent, and the seq counter is forgotten so it
   *    is re-derived from the database.
   *
   * The shared Redis seq counter is cleared too (best-effort) so the next
   * write on any instance re-seeds from the post-reset DB high-water mark.
   */
  async resetDocument(
    documentId: string,
    fullState: Uint8Array | null,
  ): Promise<void> {
    // Let any in-flight writes settle first so the delete below can't race a
    // create that would otherwise resurrect stale history.
    await this.flushDocument(documentId);

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.documentUpdate.deleteMany({ where: { documentId } });
      await tx.snapshot.deleteMany({ where: { documentId } });
      if (fullState !== null) {
        await tx.snapshot.create({
          data: { documentId, state: Buffer.from(fullState), seq: 0 },
        });
      }
    });

    this.updateCountSinceSnapshot.delete(documentId);
    this.lastPersistedSeq.delete(documentId);

    // Drop the shared Redis counter and the local seed flag so the next write
    // re-seeds from the post-reset DB high-water mark on whichever instance
    // handles it (snapshot seq 0 → next seq 1; no rows → next seq 0).
    await this.redis.del(seqKey(documentId));
    this.redisSeeded.delete(documentId);

    if (fullState !== null) {
      this.seqMap.set(documentId, 1);
    } else {
      this.seqMap.delete(documentId);
    }
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
    this.lastPersistedSeq.set(documentId, seq);
  }

  private async nextSeq(documentId: string): Promise<number> {
    // Prefer the shared Redis counter (multi-instance safe). On any Redis
    // miss/error this returns null and we fall back to the in-memory counter.
    if (this.redis.isAvailable) {
      const fromRedis = await this.redisNextSeq(documentId);
      if (fromRedis !== null) return fromRedis;
    }
    return this.inMemoryNextSeq(documentId);
  }

  private async redisNextSeq(documentId: string): Promise<number | null> {
    const key = seqKey(documentId);
    if (this.redisSeeded.has(documentId)) {
      return this.redis.incr(key);
    }
    // First allocation on this process: seed the counter to the DB high-water
    // mark (only applied if no other instance has seeded it yet) and increment.
    const floor = await this.dbHighWaterMark(documentId);
    const allocated = await this.redis.allocateSeq(key, floor);
    if (allocated !== null) this.redisSeeded.add(documentId);
    return allocated;
  }

  private async inMemoryNextSeq(documentId: string): Promise<number> {
    if (!this.seqMap.has(documentId)) {
      // Only query the DB on the first write of this process — subsequent
      // writes increment the cached counter (no per-keystroke round-trip).
      const floor = await this.dbHighWaterMark(documentId);
      this.seqMap.set(documentId, floor < 0 ? 0 : floor + 1);
    }
    const seq = this.seqMap.get(documentId) as number;
    this.seqMap.set(documentId, seq + 1);
    return seq;
  }

  /**
   * The current maximum seq for a document across both update and snapshot
   * tables, or -1 when neither exists. After compaction the DocumentUpdate
   * table may be empty while the Snapshot table holds the latest seq, so we
   * take the max of both to resume from the right number.
   */
  private async dbHighWaterMark(documentId: string): Promise<number> {
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
    return Math.max(maxUpdateSeq, maxSnapshotSeq);
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

    const snapshotSeq = this.lastPersistedSeq.get(documentId);
    if (snapshotSeq === undefined) return;

    // Rebuild the snapshot from durable rows inside a serializable transaction
    // instead of copying one instance's in-memory Y.Doc. This guarantees that
    // every update we delete is represented in the snapshot, even when several
    // replicas are editing and compacting the same document concurrently.
    const compacted = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<boolean> => {
        const base = await tx.snapshot.findFirst({
          where: { documentId },
          orderBy: { seq: 'desc' },
        });
        if (base !== null && base.seq >= snapshotSeq) return false;

        const updates = await tx.documentUpdate.findMany({
          where: {
            documentId,
            seq: { gt: base?.seq ?? -1, lte: snapshotSeq },
          },
          orderBy: { seq: 'asc' },
        });
        if (updates.length === 0) return false;

        const durableDoc = new Y.Doc();
        try {
          if (base !== null) Y.applyUpdate(durableDoc, base.state);
          for (const row of updates) Y.applyUpdate(durableDoc, row.update);

          const created = await tx.snapshot.create({
            data: {
              documentId,
              state: Buffer.from(Y.encodeStateAsUpdate(durableDoc)),
              seq: snapshotSeq,
            },
          });
          await tx.documentUpdate.deleteMany({
            where: { documentId, seq: { lte: snapshotSeq } },
          });
          await tx.snapshot.deleteMany({
            where: {
              documentId,
              seq: { lte: snapshotSeq },
              id: { not: created.id },
            },
          });
          return true;
        } finally {
          durableDoc.destroy();
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (compacted) {
      this.logger.info(
        { documentId, seq: snapshotSeq },
        'Compacted Yjs updates into snapshot',
      );
    }
  }
}
