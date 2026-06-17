import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import * as Y from 'yjs';
import type { Server } from 'socket.io';
import { DocumentRestoreService } from './document-restore.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as never;

function setup() {
  const documentManager = mockDeep<DocumentManagerService>();
  const persistence = mockDeep<DocumentPersistenceService>();
  const service = new DocumentRestoreService(documentManager, persistence, logger);

  const emit = jest.fn();
  const server = mockDeep<Server>();
  server.to.mockReturnValue({ emit } as never);
  service.registerServer(server);

  return { service, documentManager, persistence, server, emit };
}

describe('DocumentRestoreService.applyRestore', () => {
  it('replaces live Y.Doc text, broadcasts the update, and persists full state', async () => {
    const { service, documentManager, persistence, server, emit } = setup();

    // Live document currently holding stale text.
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'STALE CONTENT');
    documentManager.getDoc.mockReturnValue(doc);

    await service.applyRestore('doc-1', 'restored text');

    // The canonical Y.Text now reflects the restored content.
    expect(doc.getText('content').toString()).toBe('restored text');

    // A yjs:update and a document:restored event were broadcast to the room.
    expect(server.to).toHaveBeenCalledWith('document:doc-1');
    const events = emit.mock.calls.map((c) => c[0]);
    expect(events).toContain('yjs:update');
    expect(events).toContain('document:restored');

    // Persistence reset with a non-null full state (live path).
    expect(persistence.resetDocument).toHaveBeenCalledTimes(1);
    const [, fullState] = persistence.resetDocument.mock.calls[0]!;
    expect(fullState).not.toBeNull();
  });

  it('resets Yjs history with null state when the document is not in memory', async () => {
    const { service, documentManager, persistence, emit } = setup();
    documentManager.getDoc.mockReturnValue(undefined);

    await service.applyRestore('doc-1', 'restored text');

    expect(persistence.resetDocument).toHaveBeenCalledWith('doc-1', null);
    // Still notifies any (cross-instance) listeners that a restore happened.
    expect(emit.mock.calls.map((c) => c[0])).toContain('document:restored');
  });

  it('does not throw when no Socket.IO server is registered', async () => {
    const documentManager = mockDeep<DocumentManagerService>();
    const persistence = mockDeep<DocumentPersistenceService>();
    const service = new DocumentRestoreService(documentManager, persistence, logger);
    documentManager.getDoc.mockReturnValue(undefined);

    await expect(service.applyRestore('doc-1', 'x')).resolves.toBeUndefined();
    expect(persistence.resetDocument).toHaveBeenCalledWith('doc-1', null);
  });
});
