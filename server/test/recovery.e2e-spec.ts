import { randomUUID } from 'crypto';
import * as Y from 'yjs';
import { io, type Socket } from 'socket.io-client';
import { cleanupByEmailPrefix } from './utils/test-app';
import { bootReplicaPair, closeReplicaPair, listenTestApp, registerOwner, waitFor, type ReplicaPair } from './utils/dual-replicas';
import { DocumentManagerService } from '../src/modules/realtime/document-manager.service';
import { DocumentPersistenceService } from '../src/modules/realtime/document-persistence.service';
import { RedisService } from '../src/redis/redis.service';
import { EditorGateway } from '../src/modules/realtime/editor.gateway';
import { DocumentsService } from '../src/documents/documents.service';
import { acquireDocumentLock } from '../src/common/crdt/crdt-lineage';

const PREFIX = 'int-recovery-';

describe('Durable recovery across failures', () => {
  let pair: ReplicaPair;
  let workspaceId: string;
  let token: string;

  beforeAll(async () => {
    pair = await bootReplicaPair();
    const owner = await registerOwner(pair.a.server, PREFIX);
    token = owner.token;
    const workspace = await owner.agent.post('/workspaces').send({ name: 'Recovery' }).expect(201);
    workspaceId = workspace.body.id as string;
  }, 60_000);

  afterAll(async () => {
    await Promise.all([
      pair.a.app.get(DocumentPersistenceService).flushAll(),
      pair.b.app.get(DocumentPersistenceService).flushAll(),
    ]);
    await cleanupByEmailPrefix(pair.a.prisma, PREFIX);
    await closeReplicaPair(pair);
  });

  async function document() {
    const id = randomUUID();
    return pair.a.prisma.document.create({
      data: { workspaceId, type: 'FILE', name: id, path: id, content: '' },
    });
  }

  it('allocates above durable history after a Redis counter is lost', async () => {
    const doc = await document();
    const persistence = pair.a.app.get(DocumentPersistenceService);
    const redis = pair.a.app.get(RedisService);
    const ydoc = new Y.Doc();
    try {
      for (let i = 0; i < 3; i++) {
        ydoc.getText('content').insert(i, String(i));
        expect((await persistence.persistUpdate(doc.id, Y.encodeStateAsUpdate(ydoc), 0, randomUUID())).status).toBe('committed');
      }
      await redis.del(`meridian:doc:${doc.id}:gen:0:seq`);
      ydoc.getText('content').insert(3, 'RECOVERED');
      const result = await persistence.persistUpdate(doc.id, Y.encodeStateAsUpdate(ydoc), 0, randomUUID());
      expect(result).toMatchObject({ status: 'committed', seq: 3 });
    } finally {
      ydoc.destroy();
    }
  });

  it('recovers missing incremental edits even after they have been compacted', async () => {
    const doc = await document();
    const managerB = pair.b.app.get(DocumentManagerService);
    const peer = await managerB.acquire(doc.id);
    const persistence = pair.a.app.get(DocumentPersistenceService);
    const redis = pair.a.app.get(RedisService);
    const ydoc = new Y.Doc();
    let delta: Uint8Array = new Uint8Array();
    ydoc.on('update', (update: Uint8Array) => { delta = update; });
    try {
      ydoc.getText('content').insert(0, 'MISSED');
      await persistence.persistUpdate(doc.id, delta, 0, 'recovery-missed-update');
      // A real compaction leaves a snapshot and deletes the covered deltas.
      await pair.a.prisma.$transaction([
        pair.a.prisma.snapshot.create({ data: { documentId: doc.id, generation: 0, seq: 0, state: Buffer.from(Y.encodeStateAsUpdate(ydoc)) } }),
        pair.a.prisma.documentUpdate.deleteMany({ where: { documentId: doc.id } }),
      ]);
      ydoc.getText('content').insert(6, '+LATEST');
      const result = await persistence.persistUpdate(doc.id, delta, 0, 'recovery-latest-update');
      if (result.status !== 'committed') throw new Error('Expected commit');
      await redis.publish(`document:${doc.id}:updates`, JSON.stringify({
        originId: randomUUID(), documentId: doc.id, generation: 0,
        seq: result.seq, updateId: result.updateId, update: Buffer.from(delta).toString('base64'),
      }));
      await waitFor(() => peer.getText('content').toString() === 'MISSED+LATEST', 2_000);
    } finally {
      managerB.release(doc.id);
      ydoc.destroy();
    }
  });

  it('rejects an old-generation update after the browser rejoins the new generation', async () => {
    const doc = await document();
    await pair.a.prisma.document.update({ where: { id: doc.id }, data: { crdtGeneration: 1 } });
    const listening = await listenTestApp(pair.a);
    const socket: Socket = io(listening.url, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    const stale = new Y.Doc();
    stale.getText('content').insert(0, 'STALE');
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      await new Promise<void>((resolve) => {
        socket.once('joinedDocument', () => resolve());
        socket.emit('joinDocument', { documentId: doc.id });
      });
      const reply = await new Promise<{ event: string; payload: unknown }>((resolve) => {
        for (const event of ['yjs:ack', 'yjs:nack', 'error']) {
          socket.once(event, (payload: unknown) => resolve({ event, payload }));
        }
        socket.emit('yjs:update', { documentId: doc.id, generation: 0, updateId: 'stale-browser-outbox', update: Y.encodeStateAsUpdate(stale) });
      });
      expect(reply).toMatchObject({ event: 'yjs:nack', payload: { reason: 'stale_generation' } });
      expect(await pair.a.prisma.documentUpdate.count({ where: { documentId: doc.id } })).toBe(0);
    } finally {
      socket.close();
      stale.destroy();
    }
  });

  it('rejects a browser socket from an untrusted Origin', async () => {
    const socket = io(await pair.a.app.getUrl(), {
      auth: { token }, transports: ['websocket'], reconnection: false,
      extraHeaders: { Origin: 'https://untrusted.example.com' },
    });
    try {
      const outcome = await new Promise<string>((resolve) => {
        socket.once('connect', () => resolve('connected'));
        socket.once('connect_error', () => resolve('rejected'));
      });
      expect(outcome).toBe('rejected');
    } finally {
      socket.close();
    }
  });

  it('repairs a missed final event without requiring another edit', async () => {
    const doc = await document();
    const manager = pair.b.app.get(DocumentManagerService);
    const peer = await manager.acquire(doc.id);
    const source = new Y.Doc();
    try {
      source.getText('content').insert(0, 'NO_PUBSUB_DELIVERY');
      await pair.a.app.get(DocumentPersistenceService).persistUpdate(doc.id, Y.encodeStateAsUpdate(source), 0, randomUUID());
      await pair.b.app.get(EditorGateway).auditLoadedDocuments();
      expect(peer.getText('content').toString()).toBe('NO_PUBSUB_DELIVERY');
    } finally {
      source.destroy();
      manager.release(doc.id);
    }
  });

  it('serializes a cold load with a concurrently replaced checkpoint', async () => {
    const doc = await document();
    let release!: () => void;
    let entered!: () => void;
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const writer = pair.a.prisma.$transaction(async (tx) => {
      await acquireDocumentLock(tx, doc.id);
      await tx.document.update({ where: { id: doc.id }, data: { content: 'ATOMIC_SEED' } });
      entered();
      await hold;
    });
    await locked;
    const manager = pair.b.app.get(DocumentManagerService);
    let loaded = false;
    const reading = manager.acquire(doc.id).then((value) => { loaded = true; return value; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(loaded).toBe(false);
    } finally {
      release();
      await writer;
    }
    const state = await reading;
    expect(state.getText('content').toString()).toBe('ATOMIC_SEED');
    manager.release(doc.id);
  });

  it('increments from the locked generation when import races a restore', async () => {
    const doc = await document();
    let release!: () => void;
    let entered!: () => void;
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const writer = pair.a.prisma.$transaction(async (tx) => {
      await acquireDocumentLock(tx, doc.id);
      await tx.document.update({ where: { id: doc.id }, data: { crdtGeneration: 1 } });
      entered();
      await hold;
    });
    await locked;
    const importing = pair.b.app.get(DocumentsService).bulkCreateDocuments(workspaceId, [{
      type: 'FILE', name: doc.name, path: doc.path, content: 'IMPORTED',
    }]);
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      release();
      await writer;
    }
    expect((await importing)[0]?.crdtGeneration).toBe(2);
  });
});
