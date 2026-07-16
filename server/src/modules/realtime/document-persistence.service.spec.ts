import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { APP_CONFIG_KEY } from '../../config/app.config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOOP_AGGREGATE = { _max: { seq: null } } as never;
const NOOP_CREATE = {} as never;
const NO_SNAPSHOT = null;
const DEFAULT_THRESHOLD = 100;

function makeConfigService(snapshotEveryN = DEFAULT_THRESHOLD): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === APP_CONFIG_KEY) {
        return { snapshotEveryNUpdates: snapshotEveryN };
      }
      throw new Error(`unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

/** Redis mock with a settable `isAvailable` getter. Unavailable by default. */
function makeRedis(available = false): DeepMockProxy<RedisService> {
  const redis = mockDeep<RedisService>();
  Object.defineProperty(redis, 'isAvailable', {
    get: () => available,
    configurable: true,
  });
  return redis;
}

function makeService(
  prisma: DeepMockProxy<PrismaService>,
  logger: DeepMockProxy<PinoLogger>,
  documentManager: DeepMockProxy<DocumentManagerService>,
  snapshotEveryN = DEFAULT_THRESHOLD,
  redis: DeepMockProxy<RedisService> = makeRedis(false),
): DocumentPersistenceService {
  return new DocumentPersistenceService(
    prisma,
    redis,
    makeConfigService(snapshotEveryN),
    logger as unknown as PinoLogger,
  );
}

function makeIncrementalUpdates(count: number): Uint8Array[] {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  for (let i = 0; i < count; i++) {
    const text = doc.getText('content');
    text.insert(text.length, String(i));
  }
  doc.destroy();
  return updates;
}

// ---------------------------------------------------------------------------

describe('DocumentPersistenceService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let logger: DeepMockProxy<PinoLogger>;
  let documentManager: DeepMockProxy<DocumentManagerService>;
  let service: DocumentPersistenceService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    logger = mockDeep<PinoLogger>();
    documentManager = mockDeep<DocumentManagerService>();
    service = makeService(prisma, logger, documentManager);
    const persistedSeqByDocument = new Map<string, number>();

    // Sensible defaults — emulate the durable high-water mark updated by each
    // insert. This is important now that Redis-less allocation reads PostgreSQL
    // on every write rather than retaining a process-local sequence cache.
    prisma.documentUpdate.aggregate.mockImplementation(
      ((args: { where: { documentId: string } }) =>
        Promise.resolve({
          _max: { seq: persistedSeqByDocument.get(args.where.documentId) ?? null },
        })) as never,
    );
    prisma.documentUpdate.create.mockImplementation(
      ((args: { data: { documentId: string; seq: number } }) => {
        const previous = persistedSeqByDocument.get(args.data.documentId) ?? -1;
        persistedSeqByDocument.set(
          args.data.documentId,
          Math.max(previous, args.data.seq),
        );
        return Promise.resolve(NOOP_CREATE);
      }) as never,
    );
    // nextSeq now also reads the latest snapshot seq so the counter resumes
    // correctly after compaction.  Return null by default (no existing snapshot).
    prisma.snapshot.findFirst.mockResolvedValue(NO_SNAPSHOT);
    // Transactions run against the same deep mock by default. Individual
    // compaction tests replace this when they need to simulate a failure.
    prisma.$transaction.mockImplementation(
      ((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never,
    );
  });

  // ── Sequence counter ────────────────────────────────────────────────────

  describe('seq counter', () => {
    it('assigns seq 0 to the first update when no DB records exist', async () => {
      service.persistUpdate('doc-1', new Uint8Array([1]));
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seq: 0 }) }),
      );
    });

    it('increments seq for each subsequent update within the same document', async () => {
      service.persistUpdate('doc-1', new Uint8Array([1]));
      service.persistUpdate('doc-1', new Uint8Array([2]));
      service.persistUpdate('doc-1', new Uint8Array([3]));
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.create).toHaveBeenCalledTimes(3);
      const calls = prisma.documentUpdate.create.mock.calls;
      expect(calls[0]![0]).toMatchObject({ data: { seq: 0 } });
      expect(calls[1]![0]).toMatchObject({ data: { seq: 1 } });
      expect(calls[2]![0]).toMatchObject({ data: { seq: 2 } });
    });

    it('initialises seq from DB max + 1 when updates already exist', async () => {
      prisma.documentUpdate.aggregate.mockResolvedValue(
        { _max: { seq: 7 } } as never,
      );

      service.persistUpdate('doc-1', new Uint8Array([1]));
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seq: 8 }) }),
      );
    });

    it('initialises seq from snapshot seq + 1 when no updates exist (post-compaction restart)', async () => {
      // After compaction all DocumentUpdate rows are deleted; only the snapshot
      // carries the high-water mark.  nextSeq must read it so new writes do not
      // restart from 0, which would make them invisible during reconstruction.
      prisma.snapshot.findFirst.mockResolvedValue({ seq: 42 } as never);

      service.persistUpdate('doc-1', new Uint8Array([1]));
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seq: 43 }) }),
      );
    });

    it('uses independent counters for different documents', async () => {
      service.persistUpdate('doc-a', new Uint8Array([1]));
      service.persistUpdate('doc-b', new Uint8Array([2]));
      service.persistUpdate('doc-a', new Uint8Array([3]));
      await service.flushAll();

      const calls = prisma.documentUpdate.create.mock.calls;
      const seqByDoc: Record<string, number[]> = {};
      for (const [arg] of calls) {
        const { documentId, seq } = (
          arg as { data: { documentId: string; seq: number } }
        ).data;
        (seqByDoc[documentId] ??= []).push(seq);
      }
      expect(seqByDoc['doc-a']).toEqual([0, 1]);
      expect(seqByDoc['doc-b']).toEqual([0]);
    });

    it('reads the DB high-water mark for every Redis-less write', async () => {
      service.persistUpdate('doc-1', new Uint8Array([1]));
      service.persistUpdate('doc-1', new Uint8Array([2]));
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.aggregate).toHaveBeenCalledTimes(2);
      expect(prisma.snapshot.findFirst).toHaveBeenCalledTimes(2);
    });

    it('does not reuse a Redis-less sequence after another service advances the document', async () => {
      let highWater = -1;
      prisma.documentUpdate.aggregate.mockImplementation(
        (() => Promise.resolve({ _max: { seq: highWater } })) as never,
      );
      prisma.documentUpdate.create.mockImplementation(
        ((args: { data: { seq: number } }) => {
          highWater = Math.max(highWater, args.data.seq);
          return Promise.resolve(NOOP_CREATE);
        }) as never,
      );
      const otherService = makeService(prisma, logger, documentManager);

      service.persistUpdate('doc-1', new Uint8Array([1]));
      await service.flushDocument('doc-1');
      otherService.persistUpdate('doc-1', new Uint8Array([2]));
      await otherService.flushDocument('doc-1');
      service.persistUpdate('doc-1', new Uint8Array([3]));
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.create.mock.calls.map(
        ([args]) => (args as { data: { seq: number } }).data.seq,
      )).toEqual([0, 1, 2]);
    });

    it('takes the PostgreSQL document lock before allocating and writing', async () => {
      service.persistUpdate('doc-1', new Uint8Array([1]));
      await service.flushDocument('doc-1');

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  // ── Update bytes ────────────────────────────────────────────────────────

  describe('update bytes', () => {
    it('persists the exact bytes passed to persistUpdate', async () => {
      const update = new Uint8Array([10, 20, 30, 40]);
      service.persistUpdate('doc-1', update);
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ update: Buffer.from(update) }),
        }),
      );
    });
  });

  // ── Error handling ──────────────────────────────────────────────────────

  describe('error handling', () => {
    it('does not throw when the DB write fails', async () => {
      prisma.documentUpdate.create.mockRejectedValue(new Error('DB down'));

      service.persistUpdate('doc-1', new Uint8Array([1]));

      await expect(service.flushDocument('doc-1')).resolves.toBeUndefined();
    });

    it('logs the error when a write fails', async () => {
      prisma.documentUpdate.create.mockRejectedValue(new Error('timeout'));

      service.persistUpdate('doc-1', new Uint8Array([1]));
      await service.flushDocument('doc-1');

      expect(logger.error).toHaveBeenCalled();
    });

    it('continues processing subsequent updates after a write failure', async () => {
      prisma.documentUpdate.create
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValue(NOOP_CREATE);

      service.persistUpdate('doc-1', new Uint8Array([1]));
      service.persistUpdate('doc-1', new Uint8Array([2]));
      await service.flushDocument('doc-1');

      // Second write must still have been attempted.
      expect(prisma.documentUpdate.create).toHaveBeenCalledTimes(2);
    });
  });

  // ── Flush ───────────────────────────────────────────────────────────────

  describe('flushDocument', () => {
    it('resolves immediately when there are no pending writes', async () => {
      await expect(service.flushDocument('unknown')).resolves.toBeUndefined();
    });

    it('resolves only after the pending write completes', async () => {
      let createResolve!: (val: never) => void;
      let createCalled = false;

      prisma.documentUpdate.create.mockImplementation(
        () =>
          new Promise<never>((resolve) => {
            createCalled = true;
            createResolve = resolve;
          }) as never,
      );

      service.persistUpdate('doc-1', new Uint8Array([1]));
      let flushed = false;
      const flushPromise = service
        .flushDocument('doc-1')
        .then(() => {
          flushed = true;
        });

      // The write chain is async: Promise.resolve → doWrite → nextSeq →
      // aggregate + snapshot.findFirst (resolve) → create.  Drain microtasks
      // until create fires.
      while (!createCalled) {
        await Promise.resolve();
      }
      expect(flushed).toBe(false);

      createResolve({} as never);
      await flushPromise;
      expect(flushed).toBe(true);
    });
  });

  describe('flushAll', () => {
    it('drains pending writes across all documents', async () => {
      service.persistUpdate('doc-1', new Uint8Array([1]));
      service.persistUpdate('doc-2', new Uint8Array([2]));
      service.persistUpdate('doc-3', new Uint8Array([3]));
      service.persistUpdate('doc-1', new Uint8Array([4]));

      await service.flushAll();

      expect(prisma.documentUpdate.create).toHaveBeenCalledTimes(4);
    });

    it('resolves immediately when no writes are pending', async () => {
      await expect(service.flushAll()).resolves.toBeUndefined();
    });
  });

  describe('releaseDocument', () => {
    it('evicts all local bookkeeping after the final write settles', async () => {
      service.persistUpdate('doc-1', new Uint8Array([1]));
      expect(service.trackedDocumentCount()).toBe(1);

      await expect(service.releaseDocument('doc-1')).resolves.toBe(true);

      expect(service.trackedDocumentCount()).toBe(0);
    });

    it('retains a newer chain appended while the captured tail drains', async () => {
      let releaseFirstWrite!: () => void;
      prisma.documentUpdate.create.mockImplementationOnce(
        () => new Promise<never>((resolve) => {
          releaseFirstWrite = () => resolve(NOOP_CREATE);
        }),
      );

      service.persistUpdate('doc-1', new Uint8Array([1]));
      while (releaseFirstWrite === undefined) await Promise.resolve();
      const release = service.releaseDocument('doc-1');
      service.persistUpdate('doc-1', new Uint8Array([2]));
      releaseFirstWrite();

      await expect(release).resolves.toBe(false);
      await service.flushDocument('doc-1');
      expect(service.trackedDocumentCount()).toBe(1);
    });
  });

  // ── Compaction ──────────────────────────────────────────────────────────

  describe('compaction', () => {
    const THRESHOLD = 3;
    let cs: DocumentPersistenceService; // compact service with small threshold
    let updates: Uint8Array[];
    let durableRows: Array<{
      id: string;
      documentId: string;
      update: Buffer;
      seq: number;
      createdAt: Date;
    }>;

    beforeEach(() => {
      cs = makeService(prisma, logger, documentManager, THRESHOLD);
      updates = makeIncrementalUpdates(THRESHOLD * 2 + 1);
      durableRows = [];

      // Transaction mock: run each callback against the same prisma mock so
      // assertions on snapshot.create / deleteMany just work.
      prisma.$transaction.mockImplementation(
        ((fn: (tx: typeof prisma) => Promise<void>) => fn(prisma)) as never,
      );
      prisma.snapshot.create.mockResolvedValue({ id: 'snap-1' } as never);
      prisma.documentUpdate.deleteMany.mockResolvedValue(
        { count: THRESHOLD } as never,
      );
      prisma.snapshot.deleteMany.mockResolvedValue({ count: 0 } as never);
      prisma.documentUpdate.create.mockImplementation(
        ((args: {
          data: { documentId: string; update: Buffer; seq: number };
        }) => {
          durableRows.push({
            id: `update-${args.data.seq}`,
            ...args.data,
            createdAt: new Date(),
          });
          return Promise.resolve({});
        }) as never,
      );
      prisma.documentUpdate.aggregate.mockImplementation(
        ((args: { where: { documentId: string } }) => {
          const seqs = durableRows
            .filter((row) => row.documentId === args.where.documentId)
            .map((row) => row.seq);
          return Promise.resolve({ _max: { seq: seqs.length > 0 ? Math.max(...seqs) : null } });
        }) as never,
      );
      prisma.documentUpdate.findMany.mockImplementation(
        (() => Promise.resolve(durableRows)) as never,
      );
    });

    it('does not compact before the threshold is reached', async () => {
      for (let i = 0; i < THRESHOLD - 1; i++) {
        cs.persistUpdate('doc-1', updates[i]!);
      }
      await cs.flushDocument('doc-1');

      // Every durable write is transactional; no additional transaction means
      // compaction has not run yet.
      expect(prisma.$transaction).toHaveBeenCalledTimes(THRESHOLD - 1);
    });

    it('runs a transaction exactly once when the threshold is hit', async () => {
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', updates[i]!);
      }
      await cs.flushDocument('doc-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(THRESHOLD + 1);
    });

    it('creates a snapshot with the correct documentId and last-written seq', async () => {
      // With no pre-existing records, writes get seq 0, 1, 2.
      // The snapshot should be stamped with seq 2 (= THRESHOLD - 1).
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', updates[i]!);
      }
      await cs.flushDocument('doc-1');

      expect(prisma.snapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            documentId: 'doc-1',
            seq: THRESHOLD - 1,
          }),
        }),
      );
    });

    it('deletes all updates up to and including the snapshot seq', async () => {
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', updates[i]!);
      }
      await cs.flushDocument('doc-1');

      expect(prisma.documentUpdate.deleteMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1', seq: { lte: THRESHOLD - 1 } },
      });
    });

    it('resets the counter so each subsequent N updates triggers another compaction', async () => {
      // First batch → first compaction.
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', updates[i]!);
      }
      await cs.flushDocument('doc-1');

      // Second batch → second compaction.
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', updates[THRESHOLD + i]!);
      }
      await cs.flushDocument('doc-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(THRESHOLD * 2 + 2);
    });

    it('does not create a snapshot when no durable updates remain to compact', async () => {
      prisma.documentUpdate.findMany.mockResolvedValue([] as never);

      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', updates[i]!);
      }
      await cs.flushDocument('doc-1');

      expect(prisma.snapshot.create).not.toHaveBeenCalled();
      expect(prisma.documentUpdate.deleteMany).not.toHaveBeenCalled();
    });

    it('continues accepting writes after a compaction failure', async () => {
      let transactionCount = 0;
      prisma.$transaction.mockImplementation(
        ((fn: (tx: typeof prisma) => Promise<unknown>) => {
          transactionCount++;
          // The first three transactions write updates; the fourth is the
          // threshold-triggered compaction transaction.
          if (transactionCount === THRESHOLD + 1) {
            return Promise.reject(new Error('tx failed'));
          }
          return fn(prisma);
        }) as never,
      );

      // First batch triggers failed compaction.
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', updates[i]!);
      }
      // Second batch — these must still persist despite the earlier failure.
      cs.persistUpdate('doc-1', updates[THRESHOLD]!);
      await cs.flushDocument('doc-1');

      expect(prisma.documentUpdate.create).toHaveBeenCalledTimes(THRESHOLD + 1);
    });
  });

  // ── Shared (Redis) seq counter ──────────────────────────────────────────────

  describe('shared seq counter (Redis available)', () => {
    const KEY = 'meridian:doc:doc-1:seq';

    it('allocates seq from Redis, seeded by the DB high-water mark', async () => {
      const redis = makeRedis(true);
      redis.allocateSeq.mockResolvedValue(43);
      prisma.documentUpdate.aggregate.mockResolvedValue({ _max: { seq: 42 } } as never);
      const svc = makeService(prisma, logger, documentManager, DEFAULT_THRESHOLD, redis);

      svc.persistUpdate('doc-1', new Uint8Array([1]));
      await svc.flushDocument('doc-1');

      expect(redis.allocateSeq).toHaveBeenCalledWith(KEY, 42);
      expect(prisma.documentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seq: 43 }) }),
      );
    });

    it('uses a plain INCR after the counter has been seeded once', async () => {
      const redis = makeRedis(true);
      redis.allocateSeq.mockResolvedValue(0); // first (seeded) allocation
      redis.incr.mockResolvedValue(1); // subsequent allocations
      const svc = makeService(prisma, logger, documentManager, DEFAULT_THRESHOLD, redis);

      svc.persistUpdate('doc-1', new Uint8Array([1]));
      svc.persistUpdate('doc-1', new Uint8Array([2]));
      await svc.flushDocument('doc-1');

      expect(redis.allocateSeq).toHaveBeenCalledTimes(1);
      expect(redis.incr).toHaveBeenCalledTimes(1);
      expect(redis.incr).toHaveBeenCalledWith(KEY);
    });

    it('falls back to the in-memory counter when Redis allocation fails', async () => {
      const redis = makeRedis(true);
      redis.allocateSeq.mockResolvedValue(null); // Redis error/miss
      prisma.documentUpdate.aggregate.mockResolvedValue({ _max: { seq: null } } as never);
      const svc = makeService(prisma, logger, documentManager, DEFAULT_THRESHOLD, redis);

      svc.persistUpdate('doc-1', new Uint8Array([1]));
      await svc.flushDocument('doc-1');

      expect(redis.allocateSeq).toHaveBeenCalled();
      // Fell back to the local counter: first seq is 0.
      expect(prisma.documentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seq: 0 }) }),
      );
    });

    it('clears the Redis counter on resetDocument', async () => {
      const redis = makeRedis(true);
      const svc = makeService(prisma, logger, documentManager, DEFAULT_THRESHOLD, redis);
      prisma.$transaction.mockResolvedValue(undefined as never);

      await svc.resetDocument('doc-1', null);

      expect(redis.del).toHaveBeenCalledWith(KEY);
    });

    it('still compacts after Redis allocates the sequence numbers', async () => {
      const redis = makeRedis(true);
      redis.allocateSeq.mockResolvedValue(10);
      redis.incr.mockResolvedValueOnce(11).mockResolvedValueOnce(12);
      prisma.documentUpdate.aggregate.mockResolvedValue({ _max: { seq: 9 } } as never);
      const updates = makeIncrementalUpdates(3);
      const rows: Array<{
        id: string;
        documentId: string;
        update: Buffer;
        seq: number;
        createdAt: Date;
      }> = [];
      prisma.documentUpdate.create.mockImplementation(
        ((args: { data: { documentId: string; update: Buffer; seq: number } }) => {
          rows.push({ id: `u-${args.data.seq}`, ...args.data, createdAt: new Date() });
          return Promise.resolve({});
        }) as never,
      );
      prisma.documentUpdate.findMany.mockImplementation(
        (() => Promise.resolve(rows)) as never,
      );
      prisma.$transaction.mockImplementation(
        ((fn: (tx: typeof prisma) => Promise<void>) => fn(prisma)) as never,
      );
      prisma.snapshot.create.mockResolvedValue({ id: 'snapshot-12' } as never);
      prisma.snapshot.deleteMany.mockResolvedValue({ count: 0 } as never);
      prisma.documentUpdate.deleteMany.mockResolvedValue({ count: 3 } as never);
      const svc = makeService(prisma, logger, documentManager, 3, redis);

      for (const update of updates) svc.persistUpdate('doc-1', update);
      await svc.flushDocument('doc-1');

      expect(prisma.snapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ documentId: 'doc-1', seq: 12 }),
        }),
      );
    });
  });
});
