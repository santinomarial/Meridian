import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
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

function makeService(
  prisma: DeepMockProxy<PrismaService>,
  logger: DeepMockProxy<PinoLogger>,
  documentManager: DeepMockProxy<DocumentManagerService>,
  snapshotEveryN = DEFAULT_THRESHOLD,
): DocumentPersistenceService {
  return new DocumentPersistenceService(
    prisma,
    documentManager,
    makeConfigService(snapshotEveryN),
    logger as unknown as PinoLogger,
  );
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

    // Sensible defaults — most tests override as needed.
    prisma.documentUpdate.aggregate.mockResolvedValue(NOOP_AGGREGATE);
    prisma.documentUpdate.create.mockResolvedValue(NOOP_CREATE);
    // nextSeq now also reads the latest snapshot seq so the counter resumes
    // correctly after compaction.  Return null by default (no existing snapshot).
    prisma.snapshot.findFirst.mockResolvedValue(NO_SNAPSHOT);
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

    it('queries DB for seq only once per document across multiple updates', async () => {
      service.persistUpdate('doc-1', new Uint8Array([1]));
      service.persistUpdate('doc-1', new Uint8Array([2]));
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.aggregate).toHaveBeenCalledTimes(1);
      expect(prisma.snapshot.findFirst).toHaveBeenCalledTimes(1);
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

  // ── Compaction ──────────────────────────────────────────────────────────

  describe('compaction', () => {
    const THRESHOLD = 3;
    let cs: DocumentPersistenceService; // compact service with small threshold

    beforeEach(() => {
      cs = makeService(prisma, logger, documentManager, THRESHOLD);

      // Transaction mock: run the callback synchronously against the same
      // prisma mock so assertions on snapshot.create / deleteMany just work.
      prisma.$transaction.mockImplementation(
        ((fn: (tx: typeof prisma) => Promise<void>) => fn(prisma)) as never,
      );
      prisma.snapshot.create.mockResolvedValue({ id: 'snap-1' } as never);
      prisma.documentUpdate.deleteMany.mockResolvedValue(
        { count: THRESHOLD } as never,
      );
      // Return a non-empty state so the compaction guard passes.
      documentManager.getState.mockReturnValue(new Uint8Array([1, 2, 3]));
    });

    it('does not compact before the threshold is reached', async () => {
      for (let i = 0; i < THRESHOLD - 1; i++) {
        cs.persistUpdate('doc-1', new Uint8Array([i]));
      }
      await cs.flushDocument('doc-1');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('runs a transaction exactly once when the threshold is hit', async () => {
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', new Uint8Array([i]));
      }
      await cs.flushDocument('doc-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('creates a snapshot with the correct documentId and last-written seq', async () => {
      // With no pre-existing records, writes get seq 0, 1, 2.
      // The snapshot should be stamped with seq 2 (= THRESHOLD - 1).
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', new Uint8Array([i]));
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
        cs.persistUpdate('doc-1', new Uint8Array([i]));
      }
      await cs.flushDocument('doc-1');

      expect(prisma.documentUpdate.deleteMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1', seq: { lte: THRESHOLD - 1 } },
      });
    });

    it('resets the counter so each subsequent N updates triggers another compaction', async () => {
      // First batch → first compaction.
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', new Uint8Array([i]));
      }
      await cs.flushDocument('doc-1');

      // Second batch → second compaction.
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', new Uint8Array([i]));
      }
      await cs.flushDocument('doc-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('does not compact when the document state is empty (doc torn down)', async () => {
      documentManager.getState.mockReturnValue(new Uint8Array(0));

      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', new Uint8Array([i]));
      }
      await cs.flushDocument('doc-1');

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('continues accepting writes after a compaction failure', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('tx failed'));

      // First batch triggers failed compaction.
      for (let i = 0; i < THRESHOLD; i++) {
        cs.persistUpdate('doc-1', new Uint8Array([i]));
      }
      // Second batch — these must still persist despite the earlier failure.
      cs.persistUpdate('doc-1', new Uint8Array([99]));
      await cs.flushDocument('doc-1');

      expect(prisma.documentUpdate.create).toHaveBeenCalledTimes(THRESHOLD + 1);
    });
  });
});
