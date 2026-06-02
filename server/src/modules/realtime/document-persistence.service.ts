import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';

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
  // initialised from MAX(seq) in the database on the first write after a
  // server (re)start, then incremented locally for every subsequent write.
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

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(DocumentPersistenceService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Enqueues a durable write for one Yjs update.
   *
   * Returns immediately so the gateway can relay the update to peers without
   * waiting for the database.  Errors are caught, logged, and swallowed so a
   * transient DB failure never crashes the gateway or disrupts live editing.
   */
  persistUpdate(documentId: string, update: Uint8Array): void {
    const previous = this.writeChain.get(documentId) ?? Promise.resolve();
    const next = previous
      .then(() => this.doWrite(documentId, update))
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
  // Private
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
      // First write after (re)start: read the current high-water mark so we
      // continue from where the previous process left off.
      const result = await this.prisma.documentUpdate.aggregate({
        where: { documentId },
        _max: { seq: true },
      });
      const maxSeq = result._max.seq;
      this.seqMap.set(documentId, maxSeq !== null ? maxSeq + 1 : 0);
    }

    const seq = this.seqMap.get(documentId) as number; // set two lines above
    this.seqMap.set(documentId, seq + 1);
    return seq;
  }
}
