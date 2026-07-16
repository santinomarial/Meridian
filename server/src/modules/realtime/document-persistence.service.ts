import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';
import { acquireDocumentLock } from '../../common/crdt/crdt-lineage';
import { MetricsService } from '../../common/metrics/metrics.module';

export type PersistUpdateResult =
  | { status: 'committed'; seq: number; updateId: string; generation: number }
  | { status: 'fenced' }
  | { status: 'failed'; error: unknown };

/** Redis key holding the shared sequence counter for one document lineage. */
function seqKey(documentId: string, generation: number): string {
  return `meridian:doc:${documentId}:gen:${generation}:seq`;
}

function seededKey(documentId: string, generation: number): string {
  return `${documentId}:${generation}`;
}

@Injectable()
export class DocumentPersistenceService implements OnApplicationShutdown {
  // ---------------------------------------------------------------------------
  // Sequence counters
  //
  // The `seq` column only needs to be unique and monotonic per document
  // lineage (documentId, generation) so updates can be ordered/filtered
  // against snapshots when rebuilding a document (Yjs updates are themselves
  // commutative/idempotent).
  //
  // Allocation and persistence strategy:
  //   - Every write runs inside a PostgreSQL transaction that takes a
  //     transaction-scoped advisory lock derived from the document id.
  //   - The transaction re-reads Document.crdtGeneration while holding that
  //     lock and rejects the write when it differs from the generation the
  //     in-memory Y.Doc was loaded with (restore fencing).
  //   - When Redis is available, the transaction allocates from the shared
  //     per-lineage counter while holding that lock. Redis keeps the hot path
  //     inexpensive.
  //   - When Redis is unavailable, the transaction reads the durable high-water
  //     mark while holding the same lock and assigns the next value.
  //
  // Compaction and restore acquire the same advisory lock. That prevents a
  // replica from compacting through a sequence while another replica still has
  // an earlier allocated update waiting to be inserted. The per-process promise
  // chain below is retained as a local batching and shutdown mechanism; it is
  // not the cross-process correctness boundary.
  // ---------------------------------------------------------------------------
  // Lineages (documentId:generation) whose Redis seq counter this process has
  // already seeded, so the hot path can use a plain INCR instead of re-seeding
  // from the DB each write.
  private readonly redisSeeded = new Set<string>();

  // Per-document write chain.  Each new write is appended to the tail of the
  // existing promise so that:
  //   1. Writes for the same document are serialised (preserving seq order).
  //   2. flushDocument / flushAll can simply await the tail promise.
  private readonly writeChain = new Map<string, Promise<void>>();

  // Tracks how many updates have been persisted since the last snapshot for
  // each document.  Resets to 0 after each successful compaction.
  private readonly updateCountSinceSnapshot = new Map<string, number>();

  // Last sequence that this process successfully wrote for each document. It
  // gives local compaction a conservative durable cutoff without assuming that
  // another instance's update is already in local memory.
  private readonly lastPersistedSeq = new Map<string, number>();

  private readonly snapshotEveryN: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    configService: ConfigService,
    @InjectPinoLogger(DocumentPersistenceService.name)
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.snapshotEveryN = config.snapshotEveryNUpdates;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.flushAll();
  }

  /**
   * Enqueues a durable write for one Yjs update belonging to `generation`
   * (the generation the in-memory Y.Doc was loaded with).
   *
   * Resolves only after the PostgreSQL transaction settles:
   *   - `committed` — row inserted (or an identical updateId already existed);
   *     `seq` is the durable sequence number.
   *   - `fenced` — Document.crdtGeneration no longer matches (restore happened).
   *   - `failed` — transient DB error; the client should keep and resend the
   *     update. Errors are logged but never thrown so the write chain continues.
   *
   * Local peer relay happens in the gateway before awaiting this promise so
   * sticky-session collaborators still see low-latency edits. Cross-replica
   * Redis publication and the sender's `yjs:ack` happen only after `committed`.
   */
  persistUpdate(
    documentId: string,
    update: Uint8Array,
    generation: number,
    updateId: string,
  ): Promise<PersistUpdateResult> {
    const previous = this.writeChain.get(documentId) ?? Promise.resolve();
    let settle!: (result: PersistUpdateResult) => void;
    const resultPromise = new Promise<PersistUpdateResult>((resolve) => {
      settle = resolve;
    });

    const next = previous
      .then(() => this.doWrite(documentId, update, generation, updateId))
      .then(async (written) => {
        if (written === null) {
          this.metrics.recordPersistResult('fenced');
          settle({ status: 'fenced' });
          return;
        }
        this.metrics.recordPersistResult('committed');
        settle({
          status: 'committed',
          seq: written.seq,
          updateId: written.updateId,
          generation,
        });
        // Compaction errors are caught separately so a failed compaction does
        // not prevent subsequent updates from being written.
        await this.maybeCompact(documentId, generation).catch((err: unknown) => {
          this.logger.error(
            { documentId, err },
            'Compaction failed — will retry after next batch of updates',
          );
        });
      })
      .catch((err: unknown) => {
        this.logger.error(
          { documentId, updateId, err },
          'Failed to persist Yjs update — client should resend',
        );
        this.metrics.recordPersistResult('failed');
        settle({ status: 'failed', error: err });
      });
    this.writeChain.set(documentId, next.then(() => undefined, () => undefined));
    return resultPromise;
  }

  /** Number of documents with an in-flight local write chain (gauge source). */
  writeChainDepth(): number {
    return this.writeChain.size;
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
   * Releases process-local bookkeeping after the in-memory document has been
   * torn down. The Redis sequence key remains authoritative and is not
   * deleted; a later local open simply re-seeds its hot-path flag from the
   * durable high-water mark.
   *
   * A write appended while the captured tail is draining prevents cleanup so
   * shutdown flushing can still observe that newer chain.
   */
  async releaseDocument(documentId: string): Promise<boolean> {
    const tail = this.writeChain.get(documentId);
    if (tail !== undefined) {
      await tail;
      if (this.writeChain.get(documentId) !== tail) return false;
    }

    this.writeChain.delete(documentId);
    this.clearSeededFlags(documentId);
    this.updateCountSinceSnapshot.delete(documentId);
    this.lastPersistedSeq.delete(documentId);
    return true;
  }

  /** Number of document ids retained in any process-local persistence map. */
  trackedDocumentCount(): number {
    return new Set([
      ...this.writeChain.keys(),
      ...[...this.redisSeeded].map((key) => key.slice(0, key.lastIndexOf(':'))),
      ...this.updateCountSinceSnapshot.keys(),
      ...this.lastPersistedSeq.keys(),
    ]).size;
  }

  /**
   * Resets process-local bookkeeping after a document's CRDT generation
   * changed (restore). Enqueued writes for the old generation are rejected by
   * the in-transaction fence; this only clears counters so the new lineage
   * starts clean. Best-effort deletes the previous lineage's shared Redis seq
   * counter, which no writer will use again.
   */
  handleGenerationChange(documentId: string, newGeneration: number): void {
    this.clearSeededFlags(documentId);
    this.updateCountSinceSnapshot.delete(documentId);
    this.lastPersistedSeq.delete(documentId);
    if (newGeneration > 0) {
      void this.redis.del(seqKey(documentId, newGeneration - 1));
    }
  }

  // ---------------------------------------------------------------------------
  // Private — write
  // ---------------------------------------------------------------------------

  /**
   * Writes one update inside a locked transaction, fencing against restores:
   * if PostgreSQL's Document.crdtGeneration no longer matches the generation
   * this update was produced under, the write is dropped. Returns the durable
   * seq on success (including idempotent replay of the same updateId), or null
   * when fenced.
   */
  private async doWrite(
    documentId: string,
    update: Uint8Array,
    generation: number,
    updateId: string,
  ): Promise<{ seq: number; updateId: string } | null> {
    const result = await this.prisma.$transaction(
      async (
        tx: Prisma.TransactionClient,
      ): Promise<{ seq: number; updateId: string } | null> => {
        await acquireDocumentLock(tx, documentId);

        const document = await tx.document.findUnique({
          where: { id: documentId },
          select: { crdtGeneration: true },
        });
        if (document === null || document.crdtGeneration !== generation) {
          return null;
        }

        // Idempotent resend: the same client updateId already committed for this
        // lineage — return the existing seq without allocating another.
        const existing = await tx.documentUpdate.findFirst({
          where: { documentId, generation, updateId },
          select: { seq: true },
        });
        if (existing !== null) {
          return { seq: existing.seq, updateId };
        }

        const nextSeq = await this.nextSeq(tx, documentId, generation);
        await tx.documentUpdate.create({
          data: {
            documentId,
            generation,
            updateId,
            update: Buffer.from(update),
            seq: nextSeq,
          },
        });
        return { seq: nextSeq, updateId };
      },
    );

    if (result === null) {
      this.logger.warn(
        { documentId, generation, updateId },
        'Persistence write fenced — stale CRDT generation after restore',
      );
      return null;
    }

    this.lastPersistedSeq.set(documentId, result.seq);
    return result;
  }

  /**
   * Loads durable Yjs updates with seq strictly greater than `afterSeq` for the
   * given lineage, ordered ascending. Used by replicas that detect a sequence
   * gap (missed Redis message) to catch up from PostgreSQL.
   */
  async fetchUpdatesAfter(
    documentId: string,
    generation: number,
    afterSeq: number,
  ): Promise<Array<{ seq: number; update: Uint8Array; updateId: string | null }>> {
    const rows = await this.prisma.documentUpdate.findMany({
      where: {
        documentId,
        generation,
        seq: { gt: afterSeq },
      },
      orderBy: { seq: 'asc' },
      select: { seq: true, update: true, updateId: true },
    });
    return rows.map((row) => ({
      seq: row.seq,
      update: new Uint8Array(row.update),
      updateId: row.updateId,
    }));
  }

  private async nextSeq(
    tx: Prisma.TransactionClient,
    documentId: string,
    generation: number,
  ): Promise<number> {
    // Prefer the shared Redis counter. On any Redis miss/error we derive the
    // value from PostgreSQL while holding the document advisory lock, which is
    // collision-free across all application processes using this service.
    if (this.redis.isAvailable) {
      const fromRedis = await this.redisNextSeq(tx, documentId, generation);
      if (fromRedis !== null) return fromRedis;
    }
    return this.databaseNextSeq(tx, documentId, generation);
  }

  private async redisNextSeq(
    tx: Prisma.TransactionClient,
    documentId: string,
    generation: number,
  ): Promise<number | null> {
    const key = seqKey(documentId, generation);
    if (this.redisSeeded.has(seededKey(documentId, generation))) {
      return this.redis.incr(key);
    }
    // First allocation on this process: seed the counter to the DB high-water
    // mark (only applied if no other instance has seeded it yet) and increment.
    const floor = await this.dbHighWaterMark(tx, documentId, generation);
    const allocated = await this.redis.allocateSeq(key, floor);
    if (allocated !== null) {
      this.redisSeeded.add(seededKey(documentId, generation));
    }
    return allocated;
  }

  private async databaseNextSeq(
    tx: Prisma.TransactionClient,
    documentId: string,
    generation: number,
  ): Promise<number> {
    return (await this.dbHighWaterMark(tx, documentId, generation)) + 1;
  }

  /**
   * The current maximum seq for a document lineage across both update and
   * snapshot tables, or -1 when neither exists. After compaction the
   * DocumentUpdate table may be empty while the Snapshot table holds the
   * latest seq, so we take the max of both to resume from the right number.
   */
  private async dbHighWaterMark(
    tx: Prisma.TransactionClient,
    documentId: string,
    generation: number,
  ): Promise<number> {
    const [updateResult, snapshot] = await Promise.all([
      tx.documentUpdate.aggregate({
        where: { documentId, generation },
        _max: { seq: true },
      }),
      tx.snapshot.findFirst({
        where: { documentId, generation },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      }),
    ]);
    const maxUpdateSeq = updateResult._max.seq ?? -1;
    const maxSnapshotSeq = snapshot?.seq ?? -1;
    return Math.max(maxUpdateSeq, maxSnapshotSeq);
  }

  private clearSeededFlags(documentId: string): void {
    const prefix = `${documentId}:`;
    for (const key of this.redisSeeded) {
      if (key.startsWith(prefix)) this.redisSeeded.delete(key);
    }
  }

  // ---------------------------------------------------------------------------
  // Private — compaction
  // ---------------------------------------------------------------------------

  private async maybeCompact(
    documentId: string,
    generation: number,
  ): Promise<void> {
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
        await acquireDocumentLock(tx, documentId);

        // Restore fencing: never compact a lineage that is no longer current.
        const document = await tx.document.findUnique({
          where: { id: documentId },
          select: { crdtGeneration: true },
        });
        if (document === null || document.crdtGeneration !== generation) {
          return false;
        }

        const base = await tx.snapshot.findFirst({
          where: { documentId, generation },
          orderBy: { seq: 'desc' },
        });
        if (base !== null && base.seq >= snapshotSeq) return false;

        const updates = await tx.documentUpdate.findMany({
          where: {
            documentId,
            generation,
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
              generation,
              state: Buffer.from(Y.encodeStateAsUpdate(durableDoc)),
              seq: snapshotSeq,
            },
          });
          await tx.documentUpdate.deleteMany({
            where: { documentId, generation, seq: { lte: snapshotSeq } },
          });
          await tx.snapshot.deleteMany({
            where: {
              documentId,
              generation,
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
        { documentId, generation, seq: snapshotSeq },
        'Compacted Yjs updates into snapshot',
      );
    }
  }
}
