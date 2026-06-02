import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentPersistenceService } from './document-persistence.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOOP_AGGREGATE = { _max: { seq: null } } as never;
const NOOP_CREATE = {} as never;

function makeService(
  prisma: DeepMockProxy<PrismaService>,
  logger: DeepMockProxy<PinoLogger>,
): DocumentPersistenceService {
  return new DocumentPersistenceService(
    prisma,
    logger as unknown as PinoLogger,
  );
}

// ---------------------------------------------------------------------------

describe('DocumentPersistenceService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let logger: DeepMockProxy<PinoLogger>;
  let service: DocumentPersistenceService;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    logger = mockDeep<PinoLogger>();
    service = makeService(prisma, logger);

    // Sensible defaults — most tests override as needed.
    prisma.documentUpdate.aggregate.mockResolvedValue(NOOP_AGGREGATE);
    prisma.documentUpdate.create.mockResolvedValue(NOOP_CREATE);
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

    it('initialises seq from DB max + 1 when records already exist', async () => {
      prisma.documentUpdate.aggregate.mockResolvedValue(
        { _max: { seq: 7 } } as never,
      );

      service.persistUpdate('doc-1', new Uint8Array([1]));
      await service.flushDocument('doc-1');

      expect(prisma.documentUpdate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seq: 8 }) }),
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
        const { documentId, seq } = (arg as { data: { documentId: string; seq: number } }).data;
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
        .then(() => { flushed = true; });

      // The write chain is async: Promise.resolve → doWrite → nextSeq →
      // aggregate (resolves) → create.  Drain microtasks until create fires.
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
});
