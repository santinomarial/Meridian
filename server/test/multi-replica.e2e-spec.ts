/**
 * Multi-replica collaboration harness (roadmap #5).
 *
 * Boots two Nest AppModules against shared PostgreSQL + Redis and proves:
 *   1. Concurrent durable edits from both replicas allocate distinct seqs.
 *   2. Redis Yjs fan-out converges an open document on the peer replica.
 *   3. A Redis sequence gap is repaired from PostgreSQL catch-up.
 *   4. Live Socket.IO clients pinned to each replica see cross-replica acks
 *      and peer updates (no load balancer — affinity is simulated by pinning).
 *
 * Restore-during-edit remains covered by restore-fencing.e2e-spec.ts.
 */
import { randomUUID } from 'crypto';
import { io, type Socket } from 'socket.io-client';
import * as Y from 'yjs';
import {
  cleanupByEmailPrefix,
} from './utils/test-app';
import {
  bootReplicaPair,
  closeReplicaPair,
  listenTestApp,
  registerOwner,
  waitFor,
  type ReplicaPair,
} from './utils/dual-replicas';
import { DocumentManagerService } from '../src/modules/realtime/document-manager.service';
import { DocumentPersistenceService } from '../src/modules/realtime/document-persistence.service';
import { DocumentsService } from '../src/documents/documents.service';
import { RedisService } from '../src/redis/redis.service';

const PREFIX = 'int-multi-';

function yText(doc: Y.Doc): string {
  return doc.getText('content').toString();
}

function connectSocket(url: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5_000,
    });
    const onError = (err: Error): void => {
      socket.close();
      reject(err);
    };
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', onError);
  });
}

function onceEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Multi-replica collaboration harness', () => {
  let pair: ReplicaPair;
  let documentId: string;
  let workspaceId: string;
  let token: string;
  let managerA: DocumentManagerService;
  let managerB: DocumentManagerService;
  let persistenceA: DocumentPersistenceService;
  let persistenceB: DocumentPersistenceService;
  let redisA: RedisService;

  beforeAll(async () => {
    pair = await bootReplicaPair();
    managerA = pair.a.app.get(DocumentManagerService);
    managerB = pair.b.app.get(DocumentManagerService);
    persistenceA = pair.a.app.get(DocumentPersistenceService);
    persistenceB = pair.b.app.get(DocumentPersistenceService);
    redisA = pair.a.app.get(RedisService);

    const owner = await registerOwner(pair.a.server, PREFIX);
    token = owner.token;

    const ws = await owner.agent
      .post('/workspaces')
      .send({ name: 'Multi Replica WS' })
      .expect(201);
    workspaceId = ws.body.id as string;

    const doc = await owner.agent
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        type: 'FILE',
        name: 'collab.ts',
        path: 'collab.ts',
        language: 'typescript',
        content: 'BASE',
      })
      .expect(201);
    documentId = doc.body.id as string;
  }, 60_000);

  afterAll(async () => {
    managerA.destroyAll();
    managerB.destroyAll();
    await cleanupByEmailPrefix(pair.a.prisma, PREFIX);
    await closeReplicaPair(pair);
  });

  it('allocates distinct durable seqs for concurrent edits on both replicas', async () => {
    const docA = await managerA.acquire(documentId);
    const docB = await managerB.acquire(documentId);
    const generation = managerA.getGeneration(documentId) ?? 0;

    docA.getText('content').insert(docA.getText('content').length, '+A');
    docB.getText('content').insert(docB.getText('content').length, '+B');

    const [resultA, resultB] = await Promise.all([
      persistenceA.persistUpdate(
        documentId,
        Y.encodeStateAsUpdate(docA),
        generation,
        'multi-concurrent-a',
      ),
      persistenceB.persistUpdate(
        documentId,
        Y.encodeStateAsUpdate(docB),
        generation,
        'multi-concurrent-b',
      ),
    ]);

    expect(resultA.status).toBe('committed');
    expect(resultB.status).toBe('committed');
    if (resultA.status !== 'committed' || resultB.status !== 'committed') {
      throw new Error('expected both commits');
    }
    expect(resultA.seq).not.toBe(resultB.seq);

    const rows = await pair.a.prisma.documentUpdate.findMany({
      where: {
        documentId,
        generation,
        updateId: { in: ['multi-concurrent-a', 'multi-concurrent-b'] },
      },
      orderBy: { seq: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.seq)).size).toBe(2);

    managerA.release(documentId);
    managerB.release(documentId);
  }, 30_000);

  it('fans out a post-commit Redis update into the peer replica memory', async () => {
    expect(redisA.isAvailable).toBe(true);

    const docA = await managerA.acquire(documentId);
    const docB = await managerB.acquire(documentId);
    const generation = managerA.getGeneration(documentId) ?? 0;
    const beforeB = yText(docB);

    docA.getText('content').insert(docA.getText('content').length, '+FANOUT');
    const update = Y.encodeStateAsUpdate(docA);
    const committed = await persistenceA.persistUpdate(
      documentId,
      update,
      generation,
      'multi-fanout-1',
    );
    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') throw new Error('expected commit');

    await redisA.publish(
      `document:${documentId}:updates`,
      JSON.stringify({
        originId: randomUUID(), // foreign origin so replica A also accepts
        documentId,
        generation,
        seq: committed.seq,
        updateId: 'multi-fanout-1',
        update: Buffer.from(update).toString('base64'),
      }),
    );

    await waitFor(() => yText(docB).includes('+FANOUT'), 5_000);
    expect(yText(docB)).not.toBe(beforeB);
    expect(yText(docB)).toContain('+FANOUT');

    managerA.release(documentId);
    managerB.release(documentId);
  }, 30_000);

  it('catches up from PostgreSQL when a Redis seq gap is detected', async () => {
    expect(redisA.isAvailable).toBe(true);

    const docA = await managerA.acquire(documentId);
    const docB = await managerB.acquire(documentId);
    const generation = managerA.getGeneration(documentId) ?? 0;

    docA.getText('content').insert(docA.getText('content').length, '+GAP1');
    const update1 = Y.encodeStateAsUpdate(docA);
    const first = await persistenceA.persistUpdate(
      documentId,
      update1,
      generation,
      'multi-gap-1',
    );
    expect(first.status).toBe('committed');
    if (first.status !== 'committed') throw new Error('expected commit');

    docA.getText('content').insert(docA.getText('content').length, '+GAP2');
    const update2 = Y.encodeStateAsUpdate(docA);
    const second = await persistenceA.persistUpdate(
      documentId,
      update2,
      generation,
      'multi-gap-2',
    );
    expect(second.status).toBe('committed');
    if (second.status !== 'committed') throw new Error('expected commit');

    // Publish only the later seq — replica B must fetch the missing row.
    await redisA.publish(
      `document:${documentId}:updates`,
      JSON.stringify({
        originId: randomUUID(),
        documentId,
        generation,
        seq: second.seq,
        updateId: 'multi-gap-2',
        update: Buffer.from(update2).toString('base64'),
      }),
    );

    await waitFor(
      () => yText(docB).includes('+GAP1') && yText(docB).includes('+GAP2'),
      5_000,
    );

    managerA.release(documentId);
    managerB.release(documentId);
  }, 30_000);

  it('checkpoints under advisory lock while the peer is also writing', async () => {
    const docA = await managerA.acquire(documentId);
    const generation = managerA.getGeneration(documentId) ?? 0;
    docA.getText('content').insert(docA.getText('content').length, '+CKPT');
    await persistenceA.persistUpdate(
      documentId,
      Y.encodeStateAsUpdate(docA),
      generation,
      'multi-ckpt-write',
    );

    const documentsA = pair.a.app.get(DocumentsService);
    const documentsB = pair.b.app.get(DocumentsService);

    const [checkpoint, peerWrite] = await Promise.all([
      documentsA.checkpointDocument(documentId),
      persistenceB.persistUpdate(
        documentId,
        Y.encodeStateAsUpdate(docA),
        generation,
        'multi-ckpt-peer',
      ),
    ]);

    expect(checkpoint.content).toContain('+CKPT');
    expect(peerWrite.status).toBe('committed');

    const stored = await pair.a.prisma.document.findUnique({
      where: { id: documentId },
    });
    expect(stored?.content).toContain('+CKPT');

    managerA.release(documentId);
  }, 30_000);

  it('delivers yjs:ack on one replica and yjs:update on the other via Redis', async () => {
    const listeningA = await listenTestApp(pair.a);
    const listeningB = await listenTestApp(pair.b);

    // Ensure both replicas have the document loaded before the live path.
    await managerA.acquire(documentId);
    await managerB.acquire(documentId);

    const socketA = await connectSocket(listeningA.url, token);
    const socketB = await connectSocket(listeningB.url, token);

    try {
      const joinedA = onceEvent<{ documentId: string }>(socketA, 'joinedDocument');
      const joinedB = onceEvent<{ documentId: string }>(socketB, 'joinedDocument');
      socketA.emit('joinDocument', { documentId });
      socketB.emit('joinDocument', { documentId });
      await Promise.all([joinedA, joinedB]);

      const updateId = randomUUID();
      const scratch = new Y.Doc();
      scratch.getText('content').insert(0, 'LIVE_CROSS_REPLICA');
      const update = Y.encodeStateAsUpdate(scratch);
      scratch.destroy();

      const ackPromise = onceEvent<{
        documentId: string;
        updateId: string;
        seq: number;
      }>(socketA, 'yjs:ack');
      const peerUpdatePromise = onceEvent<{
        documentId: string;
        update: ArrayBuffer | Buffer | number[];
      }>(socketB, 'yjs:update');

      socketA.emit('yjs:update', { documentId, updateId, update });

      const ack = await ackPromise;
      expect(ack.documentId).toBe(documentId);
      expect(ack.updateId).toBe(updateId);
      expect(typeof ack.seq).toBe('number');

      const peer = await peerUpdatePromise;
      expect(peer.documentId).toBe(documentId);

      await waitFor(() => yText(managerB.getDoc(documentId)!).includes('LIVE_CROSS_REPLICA'));
    } finally {
      socketA.close();
      socketB.close();
      managerA.release(documentId);
      managerB.release(documentId);
    }
  }, 30_000);
});
