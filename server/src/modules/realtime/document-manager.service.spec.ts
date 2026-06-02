import * as Y from 'yjs';
import { DocumentManagerService } from './document-manager.service';

describe('DocumentManagerService', () => {
  let manager: DocumentManagerService;

  beforeEach(() => {
    manager = new DocumentManagerService();
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
      manager.release('doc-1'); // extra release
      expect(manager.refCount('doc-1')).toBe(0);
    });

    it('is a no-op for an unknown documentId', () => {
      expect(() => manager.release('ghost')).not.toThrow();
    });

    it('keeps the doc in memory after reaching zero refCount', () => {
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
      // Build an update on a separate doc.
      const sourceDoc = new Y.Doc();
      sourceDoc.getText('content').insert(0, 'hello world');
      const update = Y.encodeStateAsUpdate(sourceDoc);

      // Apply it to the managed doc.
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
});
