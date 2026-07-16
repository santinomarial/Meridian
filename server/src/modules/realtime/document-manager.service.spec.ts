import * as Y from 'yjs';
import type { ConfigService } from '@nestjs/config';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { DocumentManagerService } from './document-manager.service';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentPersistenceService } from './document-persistence.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_GRACE_MS = 30_000;
const TEST_GRACE_MS = 500;

// Sentinel values for Prisma mocks — typed as `never` so they satisfy the
// deeply-typed Prisma return shapes without spelling out every field.
const NO_SNAPSHOT = null;
const NO_UPDATES: never[] = [];

function makeConfigService(graceMs: number): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === APP_CONFIG_KEY) {
        return { docTeardownGraceMs: graceMs } as Partial<AppConfig>;
      }
      throw new Error(`unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocumentManagerService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let persistence: DeepMockProxy<DocumentPersistenceService>;
  let manager: DocumentManagerService;

  function makeManager(graceMs = DEFAULT_GRACE_MS): DocumentManagerService {
    return new DocumentManagerService(
      makeConfigService(graceMs),
      prisma,
      persistence,
    );
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    persistence = mockDeep<DocumentPersistenceService>();
    persistence.releaseDocument.mockResolvedValue(true);
    // Default: no existing DB state.
    prisma.document.findUnique.mockResolvedValue({
      content: null,
      crdtGeneration: 0,
    } as never);
    prisma.snapshot.findFirst.mockResolvedValue(NO_SNAPSHOT);
    prisma.documentUpdate.findMany.mockResolvedValue(NO_UPDATES);

    manager = makeManager();
  });

  afterEach(() => {
    manager.destroyAll();
  });

  describe('acquire', () => {
    it('creates a Y.Doc for a new documentId', async () => {
      const doc = await manager.acquire('doc-1');
      expect(doc).toBeInstanceOf(Y.Doc);
    });

    it('registers the document in the manager', async () => {
      await manager.acquire('doc-1');
      expect(manager.hasDocument('doc-1')).toBe(true);
    });

    it('starts refCount at 1 on first acquire', async () => {
      await manager.acquire('doc-1');
      expect(manager.refCount('doc-1')).toBe(1);
    });

    it('increments refCount on each subsequent acquire', async () => {
      await manager.acquire('doc-1');
      await manager.acquire('doc-1');
      await manager.acquire('doc-1');
      expect(manager.refCount('doc-1')).toBe(3);
    });

    it('returns the same Y.Doc instance on repeated acquires', async () => {
      const first = await manager.acquire('doc-1');
      const second = await manager.acquire('doc-1');
      expect(second).toBe(first);
    });

    it('creates independent docs for different documentIds', async () => {
      const a = await manager.acquire('doc-a');
      const b = await manager.acquire('doc-b');
      expect(a).not.toBe(b);
      expect(manager.refCount('doc-a')).toBe(1);
      expect(manager.refCount('doc-b')).toBe(1);
    });

    it('queries DB only on the first acquire for a documentId', async () => {
      await manager.acquire('doc-1');
      await manager.acquire('doc-1');

      expect(prisma.snapshot.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.documentUpdate.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('release', () => {
    it('decrements refCount', async () => {
      await manager.acquire('doc-1');
      await manager.acquire('doc-1');
      manager.release('doc-1');
      expect(manager.refCount('doc-1')).toBe(1);
    });

    it('does not go below zero', async () => {
      await manager.acquire('doc-1');
      manager.release('doc-1');
      manager.release('doc-1');
      expect(manager.refCount('doc-1')).toBe(0);
    });

    it('is a no-op for an unknown documentId', () => {
      expect(() => manager.release('ghost')).not.toThrow();
    });

    it('keeps the doc in memory while the grace timer is pending', async () => {
      await manager.acquire('doc-1');
      manager.release('doc-1');
      expect(manager.hasDocument('doc-1')).toBe(true);
    });
  });

  describe('getDoc', () => {
    it('returns the Y.Doc for a known documentId', async () => {
      const acquired = await manager.acquire('doc-1');
      expect(manager.getDoc('doc-1')).toBe(acquired);
    });

    it('returns undefined for an unknown documentId', () => {
      expect(manager.getDoc('ghost')).toBeUndefined();
    });
  });

  describe('getState', () => {
    it('returns a Uint8Array for a known document', async () => {
      await manager.acquire('doc-1');
      const state = manager.getState('doc-1');
      expect(state).toBeInstanceOf(Uint8Array);
    });

    it('returns empty Uint8Array for an unknown documentId', () => {
      const state = manager.getState('ghost');
      expect(state).toBeInstanceOf(Uint8Array);
      expect(state.length).toBe(0);
    });

    it('state changes after content is written to the doc', async () => {
      await manager.acquire('doc-1');
      const before = manager.getState('doc-1');

      const doc = manager.getDoc('doc-1')!;
      doc.getText('content').insert(0, 'hello');

      const after = manager.getState('doc-1');
      expect(after.length).toBeGreaterThan(before.length);
    });
  });

  describe('applyUpdate', () => {
    it('applies a Yjs update produced by another doc', async () => {
      const sourceDoc = new Y.Doc();
      sourceDoc.getText('content').insert(0, 'hello world');
      const update = Y.encodeStateAsUpdate(sourceDoc);

      await manager.acquire('doc-1');
      manager.applyUpdate('doc-1', update);

      const managedDoc = manager.getDoc('doc-1')!;
      expect(managedDoc.getText('content').toString()).toBe('hello world');
    });

    it('is a no-op for an unknown documentId', () => {
      const update = Y.encodeStateAsUpdate(new Y.Doc());
      expect(() => manager.applyUpdate('ghost', update)).not.toThrow();
    });

    it('the applied update is visible in getState', async () => {
      const sourceDoc = new Y.Doc();
      sourceDoc.getText('content').insert(0, 'yjs');
      const update = Y.encodeStateAsUpdate(sourceDoc);

      await manager.acquire('doc-1');
      const stateBefore = manager.getState('doc-1');
      manager.applyUpdate('doc-1', update);
      const stateAfter = manager.getState('doc-1');

      expect(stateAfter.length).toBeGreaterThan(stateBefore.length);
    });
  });

  describe('hasDocument', () => {
    it('returns false before any acquire', () => {
      expect(manager.hasDocument('doc-1')).toBe(false);
    });

    it('returns true after acquire', async () => {
      await manager.acquire('doc-1');
      expect(manager.hasDocument('doc-1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Teardown — uses Jest fake timers so no real time elapses
  // ---------------------------------------------------------------------------

  describe('teardown', () => {
    let tm: DocumentManagerService;

    beforeEach(() => {
      jest.useFakeTimers();
      tm = makeManager(TEST_GRACE_MS);
    });

    afterEach(() => {
      jest.clearAllTimers();
      tm.destroyAll();
      jest.useRealTimers();
    });

    it('schedules teardown when refCount reaches zero', async () => {
      await tm.acquire('doc-1');
      tm.release('doc-1');

      // Document still present — timer is pending, grace period not elapsed.
      expect(tm.hasDocument('doc-1')).toBe(true);
      expect(tm.refCount('doc-1')).toBe(0);
    });

    it('does not schedule a second timer on repeated release at zero', async () => {
      await tm.acquire('doc-1');
      tm.release('doc-1');
      tm.release('doc-1'); // extra release — should be idempotent

      // Advance just past grace; only one teardown should have fired.
      jest.advanceTimersByTime(TEST_GRACE_MS + 1);

      expect(tm.hasDocument('doc-1')).toBe(false);
      expect(tm.size()).toBe(0);
    });

    it('cancels teardown when the document is reacquired before the timer fires', async () => {
      await tm.acquire('doc-1');
      tm.release('doc-1');

      // Rejoin before grace period expires.
      await tm.acquire('doc-1');

      // Advance well past what the grace period would have been.
      jest.advanceTimersByTime(TEST_GRACE_MS * 2);

      expect(tm.hasDocument('doc-1')).toBe(true);
      expect(tm.refCount('doc-1')).toBe(1);
    });

    it('tears down after the grace period elapses', async () => {
      await tm.acquire('doc-1');
      tm.release('doc-1');

      jest.advanceTimersByTime(TEST_GRACE_MS + 1);

      expect(tm.hasDocument('doc-1')).toBe(false);
      expect(persistence.releaseDocument).toHaveBeenCalledWith('doc-1');
    });

    it('document is fully unavailable after teardown', async () => {
      await tm.acquire('doc-1');
      tm.release('doc-1');

      jest.advanceTimersByTime(TEST_GRACE_MS + 1);

      expect(tm.getDoc('doc-1')).toBeUndefined();
      expect(tm.getAwareness('doc-1')).toBeUndefined();
      expect(tm.size()).toBe(0);
    });

    it('only tears down the released document, not others', async () => {
      await tm.acquire('doc-1');
      await tm.acquire('doc-2');
      tm.release('doc-1');

      jest.advanceTimersByTime(TEST_GRACE_MS + 1);

      expect(tm.hasDocument('doc-1')).toBe(false);
      expect(tm.hasDocument('doc-2')).toBe(true);
      expect(tm.refCount('doc-2')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Reconstruction from DB
  // ---------------------------------------------------------------------------

  describe('reconstruction from DB', () => {
    it('returns an empty doc when no DB records exist', async () => {
      const doc = await manager.acquire('doc-1');
      expect(doc.getText('content').toString()).toBe('');
    });

    it('seeds plain-text content as a conflict-safe seq-0 Yjs update', async () => {
      prisma.document.findUnique.mockResolvedValue({
        content: 'seed me',
        crdtGeneration: 0,
      } as never);
      prisma.documentUpdate.createMany.mockResolvedValue({ count: 1 });

      const doc = await manager.acquire('doc-1');

      expect(doc.getText('content').toString()).toBe('seed me');
      expect(prisma.documentUpdate.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            documentId: 'doc-1',
            generation: 0,
            seq: 0,
            updateId: 'seed:doc-1:0',
            update: expect.any(Buffer),
          }),
        ],
        skipDuplicates: true,
      });
    });

    it('produces identical seed state on concurrent replicas', async () => {
      prisma.document.findUnique.mockResolvedValue({
        content: 'same content',
        crdtGeneration: 0,
      } as never);
      prisma.documentUpdate.createMany.mockResolvedValue({ count: 1 });
      const secondManager = makeManager();

      try {
        const [first, second] = await Promise.all([
          manager.acquire('doc-shared'),
          secondManager.acquire('doc-shared'),
        ]);

        expect(Buffer.from(Y.encodeStateAsUpdate(first))).toEqual(
          Buffer.from(Y.encodeStateAsUpdate(second)),
        );
      } finally {
        secondManager.destroyAll();
      }
    });

    it('applies snapshot state to a fresh doc', async () => {
      const sourceDoc = new Y.Doc();
      sourceDoc.getText('content').insert(0, 'hello from snapshot');
      const snapshotState = Y.encodeStateAsUpdate(sourceDoc);

      prisma.snapshot.findFirst.mockResolvedValue({
        id: 'snap-1',
        documentId: 'doc-1',
        state: Buffer.from(snapshotState),
        seq: 4,
        createdAt: new Date(),
      } as never);

      const doc = await manager.acquire('doc-1');
      expect(doc.getText('content').toString()).toBe('hello from snapshot');
    });

    it('loads updates after the snapshot seq, not all updates', async () => {
      prisma.snapshot.findFirst.mockResolvedValue({
        id: 'snap-1',
        documentId: 'doc-1',
        state: Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())),
        seq: 5,
        createdAt: new Date(),
      } as never);

      await manager.acquire('doc-1');

      expect(prisma.documentUpdate.findMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1', generation: 0, seq: { gt: 5 } },
        orderBy: { seq: 'asc' },
      });
    });

    it('loads all updates when no snapshot exists', async () => {
      // prisma.snapshot.findFirst returns null (the outer beforeEach default)
      await manager.acquire('doc-1');

      expect(prisma.documentUpdate.findMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1', generation: 0, seq: { gt: -1 } },
        orderBy: { seq: 'asc' },
      });
    });

    it('applies delta updates on top of snapshot state', async () => {
      // Build a snapshot with 'base' content.
      const baseDoc = new Y.Doc();
      baseDoc.getText('content').insert(0, 'base');
      const snapshotState = Y.encodeStateAsUpdate(baseDoc);

      // Build an incremental delta from the snapshot state vector.
      const sv = Y.encodeStateVector(baseDoc);
      baseDoc.getText('content').insert(4, ' world');
      const deltaUpdate = Y.encodeStateAsUpdate(baseDoc, sv);

      prisma.snapshot.findFirst.mockResolvedValue({
        id: 'snap-1',
        documentId: 'doc-1',
        state: Buffer.from(snapshotState),
        seq: 0,
        createdAt: new Date(),
      } as never);

      prisma.documentUpdate.findMany.mockResolvedValue([
        {
          id: 'u-1',
          documentId: 'doc-1',
          update: Buffer.from(deltaUpdate),
          seq: 1,
          createdAt: new Date(),
        },
      ] as never);

      const doc = await manager.acquire('doc-1');
      expect(doc.getText('content').toString()).toBe('base world');
    });

    it('applies multiple updates in seq order', async () => {
      // First update: inserts 'hello'.
      const docSrc = new Y.Doc();
      docSrc.getText('content').insert(0, 'hello');
      const updateA = Y.encodeStateAsUpdate(docSrc);

      // Second update: appends ' world'.
      const sv = Y.encodeStateVector(docSrc);
      docSrc.getText('content').insert(5, ' world');
      const updateB = Y.encodeStateAsUpdate(docSrc, sv);

      prisma.documentUpdate.findMany.mockResolvedValue([
        {
          id: 'u-1',
          documentId: 'doc-1',
          update: Buffer.from(updateA),
          seq: 0,
          createdAt: new Date(),
        },
        {
          id: 'u-2',
          documentId: 'doc-1',
          update: Buffer.from(updateB),
          seq: 1,
          createdAt: new Date(),
        },
      ] as never);

      const doc = await manager.acquire('doc-1');
      expect(doc.getText('content').toString()).toBe('hello world');
    });

    it('cold-load after compaction: snapshot at seq N with no remaining updates', async () => {
      // Simulates the DB state left after compaction: a snapshot at a high seq
      // and no DocumentUpdate rows (all deleted).  The reconstruction must load
      // content from the snapshot and query only updates with seq > snapshotSeq
      // (which returns nothing here).
      const compactedDoc = new Y.Doc();
      compactedDoc.getText('content').insert(0, 'compacted content');
      const snapshotState = Y.encodeStateAsUpdate(compactedDoc);

      prisma.snapshot.findFirst.mockResolvedValue({
        id: 'snap-1',
        documentId: 'doc-1',
        state: Buffer.from(snapshotState),
        seq: 99,
        createdAt: new Date(),
      } as never);
      // All updates were deleted during compaction.
      prisma.documentUpdate.findMany.mockResolvedValue([] as never);

      const doc = await manager.acquire('doc-1');

      expect(doc.getText('content').toString()).toBe('compacted content');
      // Must query only updates AFTER the snapshot seq, not all updates.
      expect(prisma.documentUpdate.findMany).toHaveBeenCalledWith({
        where: { documentId: 'doc-1', generation: 0, seq: { gt: 99 } },
        orderBy: { seq: 'asc' },
      });
    });

    it('reconstructed doc has the same content as the original', async () => {
      // Simulate a write session: snapshot at seq 0, then two deltas.
      const workDoc = new Y.Doc();
      workDoc.getText('content').insert(0, 'line one');
      const snapshotState = Y.encodeStateAsUpdate(workDoc);

      const sv1 = Y.encodeStateVector(workDoc);
      workDoc.getText('content').insert(8, '\nline two');
      const delta1 = Y.encodeStateAsUpdate(workDoc, sv1);

      const sv2 = Y.encodeStateVector(workDoc);
      workDoc.getText('content').insert(17, '\nline three');
      const delta2 = Y.encodeStateAsUpdate(workDoc, sv2);

      const expectedContent = workDoc.getText('content').toString();

      prisma.snapshot.findFirst.mockResolvedValue({
        id: 'snap-1',
        documentId: 'doc-1',
        state: Buffer.from(snapshotState),
        seq: 0,
        createdAt: new Date(),
      } as never);

      prisma.documentUpdate.findMany.mockResolvedValue([
        {
          id: 'u-1',
          documentId: 'doc-1',
          update: Buffer.from(delta1),
          seq: 1,
          createdAt: new Date(),
        },
        {
          id: 'u-2',
          documentId: 'doc-1',
          update: Buffer.from(delta2),
          seq: 2,
          createdAt: new Date(),
        },
      ] as never);

      // Clear in-memory state and re-acquire (simulates server restart).
      manager.destroyAll();
      const reconstructed = await manager.acquire('doc-1');

      expect(reconstructed.getText('content').toString()).toBe(expectedContent);
    });
  });
});
