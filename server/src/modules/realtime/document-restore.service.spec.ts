import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Server } from 'socket.io';
import { DocumentRestoreService } from './document-restore.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as never;

function setup() {
  const documentManager = mockDeep<DocumentManagerService>();
  const persistence = mockDeep<DocumentPersistenceService>();
  const redis = mockDeep<RedisService>();
  const prisma = mockDeep<PrismaService>();
  const service = new DocumentRestoreService(
    documentManager,
    persistence,
    redis,
    prisma,
    logger,
  );

  const emit = jest.fn();
  const server = mockDeep<Server>();
  server.to.mockReturnValue({ emit } as never);
  service.registerServer(server);

  return { service, documentManager, persistence, redis, prisma, server, emit };
}

/** Captures the Redis subscribe handler registered in onModuleInit. */
async function captureRedisHandler(
  service: DocumentRestoreService,
  redis: DeepMockProxy<RedisService>,
): Promise<(channel: string, message: string) => void> {
  let handler: ((channel: string, message: string) => void) | undefined;
  redis.subscribe.mockImplementation(async (_pattern, cb) => {
    handler = cb as (channel: string, message: string) => void;
  });
  await service.onModuleInit();
  if (handler === undefined) {
    throw new Error('Redis subscribe handler was not registered');
  }
  return handler;
}

describe('DocumentRestoreService.applyRestore', () => {
  it('reloads when loaded, publishes Redis restore-control, and emits document:restored', async () => {
    const { service, documentManager, persistence, redis, server, emit } =
      setup();
    documentManager.hasDocument.mockReturnValue(true);
    documentManager.reload.mockResolvedValue(undefined);
    redis.publish.mockResolvedValue(undefined as never);

    await service.applyRestore('doc-1', 3);

    expect(persistence.handleGenerationChange).toHaveBeenCalledWith('doc-1', 3);
    expect(documentManager.reload).toHaveBeenCalledWith('doc-1');
    expect(server.to).toHaveBeenCalledWith('document:doc-1');
    expect(emit).toHaveBeenCalledWith('document:restored', {
      documentId: 'doc-1',
      generation: 3,
    });
    expect(redis.publish).toHaveBeenCalledWith(
      'document:doc-1:restore',
      expect.any(String),
    );

    const payload = JSON.parse(redis.publish.mock.calls[0]![1] as string) as {
      originId: string;
      documentId: string;
      generation: number;
    };
    expect(payload).toMatchObject({
      documentId: 'doc-1',
      generation: 3,
    });
    expect(typeof payload.originId).toBe('string');
  });

  it('still publishes and emits when the document is not loaded (no reload)', async () => {
    const { service, documentManager, persistence, redis, emit } = setup();
    documentManager.hasDocument.mockReturnValue(false);
    redis.publish.mockResolvedValue(undefined as never);

    await service.applyRestore('doc-1', 2);

    expect(persistence.handleGenerationChange).toHaveBeenCalledWith('doc-1', 2);
    expect(documentManager.reload).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('document:restored', {
      documentId: 'doc-1',
      generation: 2,
    });
    expect(redis.publish).toHaveBeenCalledWith(
      'document:doc-1:restore',
      expect.any(String),
    );
  });

  it('does not throw when no Socket.IO server is registered', async () => {
    const documentManager = mockDeep<DocumentManagerService>();
    const persistence = mockDeep<DocumentPersistenceService>();
    const redis = mockDeep<RedisService>();
    const prisma = mockDeep<PrismaService>();
    const service = new DocumentRestoreService(
      documentManager,
      persistence,
      redis,
      prisma,
      logger,
    );
    documentManager.hasDocument.mockReturnValue(false);
    redis.publish.mockResolvedValue(undefined as never);

    await expect(service.applyRestore('doc-1', 1)).resolves.toBeUndefined();
    expect(persistence.handleGenerationChange).toHaveBeenCalledWith('doc-1', 1);
    expect(redis.publish).toHaveBeenCalled();
  });
});

describe('DocumentRestoreService.auditGenerations', () => {
  it('evicts when the loaded generation differs from PostgreSQL', async () => {
    const { service, documentManager, persistence, prisma, emit } = setup();
    documentManager.loadedDocumentIds.mockReturnValue(['doc-1']);
    documentManager.getGeneration.mockReturnValue(0);
    documentManager.hasDocument.mockReturnValue(true);
    documentManager.reload.mockResolvedValue(undefined);
    prisma.document.findMany.mockResolvedValue([
      { id: 'doc-1', crdtGeneration: 4 },
    ] as never);

    await service.auditGenerations();

    expect(persistence.handleGenerationChange).toHaveBeenCalledWith('doc-1', 4);
    expect(documentManager.reload).toHaveBeenCalledWith('doc-1');
    expect(emit).toHaveBeenCalledWith('document:restored', {
      documentId: 'doc-1',
      generation: 4,
    });
  });

  it('does not evict when loaded generation matches the database', async () => {
    const { service, documentManager, persistence, prisma } = setup();
    documentManager.loadedDocumentIds.mockReturnValue(['doc-1']);
    documentManager.getGeneration.mockReturnValue(2);
    prisma.document.findMany.mockResolvedValue([
      { id: 'doc-1', crdtGeneration: 2 },
    ] as never);

    await service.auditGenerations();

    expect(persistence.handleGenerationChange).not.toHaveBeenCalled();
    expect(documentManager.reload).not.toHaveBeenCalled();
  });
});

describe('DocumentRestoreService Redis restore-control handler', () => {
  afterEach(async () => {
    // Suites below call onModuleInit (audit timer + Redis subscribe).
  });

  it('ignores messages that carry this replica\'s own originId', async () => {
    const { service, documentManager, persistence, redis } = setup();
    documentManager.hasDocument.mockReturnValue(false);
    redis.publish.mockResolvedValue(undefined as never);
    redis.unsubscribe.mockResolvedValue(undefined as never);

    const handler = await captureRedisHandler(service, redis);

    try {
      await service.applyRestore('doc-1', 5);
      const published = redis.publish.mock.calls[0]![1] as string;

      persistence.handleGenerationChange.mockClear();
      documentManager.reload.mockClear();

      // Echo our own published message back through the subscriber.
      handler('document:doc-1:restore', published);

      // Allow any fire-and-forget work to settle.
      await Promise.resolve();

      expect(persistence.handleGenerationChange).not.toHaveBeenCalled();
      expect(documentManager.reload).not.toHaveBeenCalled();
    } finally {
      await service.onModuleDestroy();
    }
  });

  it('applies remote restore-control messages from other replicas', async () => {
    const { service, documentManager, persistence, redis, emit } = setup();
    documentManager.hasDocument.mockReturnValue(true);
    documentManager.reload.mockResolvedValue(undefined);
    redis.unsubscribe.mockResolvedValue(undefined as never);

    const handler = await captureRedisHandler(service, redis);

    try {
      handler(
        'document:doc-1:restore',
        JSON.stringify({
          originId: 'other-replica',
          documentId: 'doc-1',
          generation: 7,
        }),
      );

      // Remote handler is fire-and-forget; drain microtasks until reload settles.
      await new Promise((resolve) => setImmediate(resolve));

      expect(persistence.handleGenerationChange).toHaveBeenCalledWith('doc-1', 7);
      expect(documentManager.reload).toHaveBeenCalledWith('doc-1');
      expect(emit).toHaveBeenCalledWith('document:restored', {
        documentId: 'doc-1',
        generation: 7,
      });
    } finally {
      await service.onModuleDestroy();
    }
  });
});
