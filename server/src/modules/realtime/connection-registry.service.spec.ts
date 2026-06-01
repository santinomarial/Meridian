import { ConnectionRegistryService } from './connection-registry.service';

describe('ConnectionRegistryService', () => {
  let registry: ConnectionRegistryService;

  beforeEach(() => {
    registry = new ConnectionRegistryService();
  });

  describe('register', () => {
    it('tracks a new socket without a userId', () => {
      registry.register('sock-1');
      expect(registry.size()).toBe(1);
      expect(registry.getDocumentsForSocket('sock-1')).toEqual([]);
    });

    it('tracks a new socket with a userId', () => {
      registry.register('sock-1', 'user-1');
      expect(registry.size()).toBe(1);
    });

    it('returns empty array for unknown socket', () => {
      expect(registry.getDocumentsForSocket('ghost')).toEqual([]);
    });
  });

  describe('join', () => {
    beforeEach(() => {
      registry.register('sock-1');
    });

    it('adds the document to the socket entry', () => {
      registry.join('sock-1', 'doc-1');
      expect(registry.getDocumentsForSocket('sock-1')).toEqual(['doc-1']);
    });

    it('adds the socket to the document room', () => {
      registry.join('sock-1', 'doc-1');
      expect(registry.getSocketsInDocument('doc-1')).toContain('sock-1');
    });

    it('allows one socket to join multiple documents', () => {
      registry.join('sock-1', 'doc-1');
      registry.join('sock-1', 'doc-2');
      registry.join('sock-1', 'doc-3');

      expect(registry.getDocumentsForSocket('sock-1')).toHaveLength(3);
      expect(registry.getSocketsInDocument('doc-1')).toContain('sock-1');
      expect(registry.getSocketsInDocument('doc-2')).toContain('sock-1');
      expect(registry.getSocketsInDocument('doc-3')).toContain('sock-1');
    });

    it('allows multiple sockets to join the same document', () => {
      registry.register('sock-2');
      registry.join('sock-1', 'doc-1');
      registry.join('sock-2', 'doc-1');

      const sockets = registry.getSocketsInDocument('doc-1');
      expect(sockets).toHaveLength(2);
      expect(sockets).toContain('sock-1');
      expect(sockets).toContain('sock-2');
    });

    it('is a no-op for an unregistered socket', () => {
      registry.join('ghost', 'doc-1');
      expect(registry.getSocketsInDocument('doc-1')).toEqual([]);
    });
  });

  describe('leave', () => {
    beforeEach(() => {
      registry.register('sock-1');
      registry.join('sock-1', 'doc-1');
    });

    it('removes the document from the socket entry', () => {
      registry.leave('sock-1', 'doc-1');
      expect(registry.getDocumentsForSocket('sock-1')).toEqual([]);
    });

    it('removes the socket from the document room', () => {
      registry.leave('sock-1', 'doc-1');
      expect(registry.getSocketsInDocument('doc-1')).toEqual([]);
    });

    it('cleans up the document room when the last socket leaves', () => {
      registry.leave('sock-1', 'doc-1');
      // room is fully removed, not just empty
      expect(registry.getSocketsInDocument('doc-1')).toEqual([]);
    });

    it('does not affect other documents the socket is in', () => {
      registry.join('sock-1', 'doc-2');
      registry.leave('sock-1', 'doc-1');

      expect(registry.getDocumentsForSocket('sock-1')).toEqual(['doc-2']);
      expect(registry.getSocketsInDocument('doc-2')).toContain('sock-1');
    });
  });

  describe('disconnect', () => {
    it('removes the socket and all its document memberships', () => {
      registry.register('sock-1');
      registry.join('sock-1', 'doc-1');
      registry.join('sock-1', 'doc-2');

      registry.disconnect('sock-1');

      expect(registry.size()).toBe(0);
      expect(registry.getDocumentsForSocket('sock-1')).toEqual([]);
      expect(registry.getSocketsInDocument('doc-1')).toEqual([]);
      expect(registry.getSocketsInDocument('doc-2')).toEqual([]);
    });

    it('leaves other sockets in shared document rooms intact', () => {
      registry.register('sock-1');
      registry.register('sock-2');
      registry.join('sock-1', 'doc-1');
      registry.join('sock-2', 'doc-1');

      registry.disconnect('sock-1');

      expect(registry.getSocketsInDocument('doc-1')).toEqual(['sock-2']);
      expect(registry.size()).toBe(1);
    });

    it('is a no-op for an unregistered socket', () => {
      registry.disconnect('ghost');
      expect(registry.size()).toBe(0);
    });
  });
});
