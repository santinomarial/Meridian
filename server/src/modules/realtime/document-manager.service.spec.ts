import * as Y from 'yjs';
import type { ConfigService } from '@nestjs/config';
import { DocumentManagerService } from './document-manager.service';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_GRACE_MS = 30_000;
const TEST_GRACE_MS = 500;

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
  let manager: DocumentManagerService;

  beforeEach(() => {
    manager = new DocumentManagerService(makeConfigService(DEFAULT_GRACE_MS));
  });

  afterEach(() => {
    manager.destroyAll();
  });

  describe('acquire', () => {
    it('creates a Y.Doc for a new documentId', () => {
      const doc = manager.acquire('doc-1');
      expect(doc).toBeInstanceOf(Y.Doc);
    });

    it('registers the document in the manager', () => {
      manager.acquire('doc-1');
      expect(manager.hasDocument('doc-1')).toBe(true);
    });

    it('starts refCount at 1 on first acquire', () => {
      manager.acquire('doc-1');
      expect(manager.refCount('doc-1')).toBe(1);
    });

    it('increments refCount on each subsequent acquire', () => {
      manager.acquire('doc-1');
      manager.acquire('doc-1');
      manager.acquire('doc-1');
      expect(manager.refCount('doc-1')).toBe(3);
    });

    it('returns the same Y.Doc instance on repeated acquires', () => {
      const first = manager.acquire('doc-1');
      const second = manager.acquire('doc-1');
      expect(second).toBe(first);
    });

    it('creates independent docs for different documentIds', () => {
      const a = manager.acquire('doc-a');
      const b = manager.acquire('doc-b');
      expect(a).not.toBe(b);
      expect(manager.refCount('doc-a')).toBe(1);
      expect(manager.refCount('doc-b')).toBe(1);
    });
  });

  describe('release', () => {
    it('decrements refCount', () => {
      manager.acquire('doc-1');
      manager.acquire('doc-1');
      manager.release('doc-1');
      expect(manager.refCount('doc-1')).toBe(1);
    });

    it('does not go below zero', () => {
      manager.acquire('doc-1');
      manager.release('doc-1');
      manager.release('doc-1');
      expect(manager.refCount('doc-1')).toBe(0);
    });

    it('is a no-op for an unknown documentId', () => {
      expect(() => manager.release('ghost')).not.toThrow();
    });

    it('keeps the doc in memory while the grace timer is pending', () => {
      manager.acquire('doc-1');
      manager.release('doc-1');
      expect(manager.hasDocument('doc-1')).toBe(true);
    });
  });

  describe('getDoc', () => {
    it('returns the Y.Doc for a known documentId', () => {
      const acquired = manager.acquire('doc-1');
      expect(manager.getDoc('doc-1')).toBe(acquired);
    });

    it('returns undefined for an unknown documentId', () => {
      expect(manager.getDoc('ghost')).toBeUndefined();
    });
  });

  describe('getState', () => {
    it('returns a Uint8Array for a known document', () => {
      manager.acquire('doc-1');
      const state = manager.getState('doc-1');
      expect(state).toBeInstanceOf(Uint8Array);
    });

    it('returns empty Uint8Array for an unknown documentId', () => {
      const state = manager.getState('ghost');
      expect(state).toBeInstanceOf(Uint8Array);
      expect(state.length).toBe(0);
    });

    it('state changes after content is written to the doc', () => {
      manager.acquire('doc-1');
      const before = manager.getState('doc-1');

      const doc = manager.getDoc('doc-1')!;
      doc.getText('content').insert(0, 'hello');

      const after = manager.getState('doc-1');
      expect(after.length).toBeGreaterThan(before.length);
    });
  });

  describe('applyUpdate', () => {
    it('applies a Yjs update produced by another doc', () => {
      const sourceDoc = new Y.Doc();
      sourceDoc.getText('content').insert(0, 'hello world');
      const update = Y.encodeStateAsUpdate(sourceDoc);

      manager.acquire('doc-1');
      manager.applyUpdate('doc-1', update);

      const managedDoc = manager.getDoc('doc-1')!;
      expect(managedDoc.getText('content').toString()).toBe('hello world');
    });

    it('is a no-op for an unknown documentId', () => {
      const update = Y.encodeStateAsUpdate(new Y.Doc());
      expect(() => manager.applyUpdate('ghost', update)).not.toThrow();
    });

    it('the applied update is visible in getState', () => {
      const sourceDoc = new Y.Doc();
      sourceDoc.getText('content').insert(0, 'yjs');
      const update = Y.encodeStateAsUpdate(sourceDoc);

      manager.acquire('doc-1');
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

    it('returns true after acquire', () => {
      manager.acquire('doc-1');
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
      tm = new DocumentManagerService(makeConfigService(TEST_GRACE_MS));
    });

    afterEach(() => {
      jest.clearAllTimers();
      tm.destroyAll();
      jest.useRealTimers();
    });

    it('schedules teardown when refCount reaches zero', () => {
      tm.acquire('doc-1');
      tm.release('doc-1');

      // Document still present — timer is pending, grace period not elapsed.
      expect(tm.hasDocument('doc-1')).toBe(true);
      expect(tm.refCount('doc-1')).toBe(0);
    });

    it('does not schedule a second timer on repeated release at zero', () => {
      tm.acquire('doc-1');
      tm.release('doc-1');
      tm.release('doc-1'); // extra release — should be idempotent

      // Advance just past grace; only one teardown should have fired.
      jest.advanceTimersByTime(TEST_GRACE_MS + 1);

      expect(tm.hasDocument('doc-1')).toBe(false);
      expect(tm.size()).toBe(0);
    });

    it('cancels teardown when the document is reacquired before the timer fires', () => {
      tm.acquire('doc-1');
      tm.release('doc-1');

      // Rejoin before grace period expires.
      tm.acquire('doc-1');

      // Advance well past what the grace period would have been.
      jest.advanceTimersByTime(TEST_GRACE_MS * 2);

      expect(tm.hasDocument('doc-1')).toBe(true);
      expect(tm.refCount('doc-1')).toBe(1);
    });

    it('tears down after the grace period elapses', () => {
      tm.acquire('doc-1');
      tm.release('doc-1');

      jest.advanceTimersByTime(TEST_GRACE_MS + 1);

      expect(tm.hasDocument('doc-1')).toBe(false);
    });

    it('document is fully unavailable after teardown', () => {
      tm.acquire('doc-1');
      tm.release('doc-1');

      jest.advanceTimersByTime(TEST_GRACE_MS + 1);

      expect(tm.getDoc('doc-1')).toBeUndefined();
      expect(tm.getAwareness('doc-1')).toBeUndefined();
      expect(tm.size()).toBe(0);
    });

    it('only tears down the released document, not others', () => {
      tm.acquire('doc-1');
      tm.acquire('doc-2');
      tm.release('doc-1');

      jest.advanceTimersByTime(TEST_GRACE_MS + 1);

      expect(tm.hasDocument('doc-1')).toBe(false);
      expect(tm.hasDocument('doc-2')).toBe(true);
      expect(tm.refCount('doc-2')).toBe(1);
    });
  });
});
