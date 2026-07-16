/**
 * Durable collaboration acknowledgements completion test.
 *
 * Proves:
 *   1. After persist returns `committed`, the DocumentUpdate row survives in
 *      PostgreSQL (survive-after-ack).
 *   2. A duplicate resend with the same updateId does not allocate a second
 *      seq / row (idempotent duplicate).
 *   3. A second distinct updateId under the same generation still advances seq.
 *
 * The client IndexedDB queue + yjs:ack path is covered by unit tests; this
 * harness focuses on the durable server contract the queue depends on.
 */
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import * as Y from 'yjs';
import {
  createTestApp,
  cleanupByEmailPrefix,
  uniqueEmail,
  STRONG_PASSWORD,
  type TestApp,
} from './utils/test-app';
import { DocumentManagerService } from '../src/modules/realtime/document-manager.service';
import { DocumentPersistenceService } from '../src/modules/realtime/document-persistence.service';

const PREFIX = 'int-acks-';

async function registerOwner(server: TestApp['server']): Promise<TestAgent> {
  const agent = request.agent(server);
  await agent
    .post('/auth/register')
    .send({
      email: uniqueEmail(PREFIX),
      password: STRONG_PASSWORD,
      displayName: 'Ack Owner',
    })
    .expect(201);
  return agent;
}

describe('Durable collaboration acknowledgements', () => {
  let app: TestApp;
  let owner: TestAgent;
  let documentId: string;
  let manager: DocumentManagerService;
  let persistence: DocumentPersistenceService;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app.server);

    const ws = await owner
      .post('/workspaces')
      .send({ name: 'Ack WS' })
      .expect(201);
    const workspaceId = ws.body.id as string;

    const doc = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        type: 'FILE',
        name: 'ack.md',
        path: 'ack.md',
        language: 'markdown',
        content: 'BASE',
      })
      .expect(201);
    documentId = doc.body.id as string;

    manager = app.app.get(DocumentManagerService);
    persistence = app.app.get(DocumentPersistenceService);
  }, 60_000);

  afterAll(async () => {
    await cleanupByEmailPrefix(app.prisma, PREFIX);
    await app.app.close();
  });

  it('commits under updateId, survives flush, and dedupes duplicate resends', async () => {
    const ydoc = await manager.acquire(documentId);
    const generation = manager.getGeneration(documentId) ?? 0;

    ydoc.getText('content').insert(ydoc.getText('content').length, '+ACKED');
    const update = Y.encodeStateAsUpdate(ydoc);
    const updateId = 'client-update-survive-1';

    const first = await persistence.persistUpdate(
      documentId,
      update,
      generation,
      updateId,
    );
    expect(first).toMatchObject({
      status: 'committed',
      updateId,
      generation,
    });
    if (first.status !== 'committed') {
      throw new Error('expected committed');
    }
    const committedSeq = first.seq;

    // Survive-after-ack: row is in PostgreSQL after the promise resolves.
    const row = await app.prisma.documentUpdate.findFirst({
      where: { documentId, generation, updateId },
    });
    expect(row).not.toBeNull();
    expect(row!.seq).toBe(committedSeq);

    // Duplicate resend (client killed before ack / reconnect resend): same seq,
    // still a single row.
    const replay = await persistence.persistUpdate(
      documentId,
      update,
      generation,
      updateId,
    );
    expect(replay).toEqual({
      status: 'committed',
      seq: committedSeq,
      updateId,
      generation,
    });

    const count = await app.prisma.documentUpdate.count({
      where: { documentId, generation, updateId },
    });
    expect(count).toBe(1);

    // A distinct client update still advances the durable sequence.
    ydoc.getText('content').insert(ydoc.getText('content').length, '+NEXT');
    const nextUpdate = Y.encodeStateAsUpdate(ydoc);
    const second = await persistence.persistUpdate(
      documentId,
      nextUpdate,
      generation,
      'client-update-survive-2',
    );
    expect(second.status).toBe('committed');
    if (second.status === 'committed') {
      expect(second.seq).toBeGreaterThan(committedSeq);
    }

    manager.release(documentId);
  }, 30_000);
});
