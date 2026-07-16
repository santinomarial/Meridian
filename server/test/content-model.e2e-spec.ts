/**
 * Authoritative content model completion test.
 *
 * Proves:
 *   1. Collaborative CRDT edits do not appear in Document.content until checkpoint.
 *   2. POST /checkpoint projects durable CRDT text into Document.content + version.
 *   3. PATCH content is rejected once the dual-write path is closed.
 *   4. Export reads the checkpoint (post-save), not the stale pre-edit column.
 */
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import JSZip from 'jszip';
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

const PREFIX = 'int-content-';

async function registerOwner(server: TestApp['server']): Promise<TestAgent> {
  const agent = request.agent(server);
  await agent
    .post('/auth/register')
    .send({
      email: uniqueEmail(PREFIX),
      password: STRONG_PASSWORD,
      displayName: 'Content Owner',
    })
    .expect(201);
  return agent;
}

describe('Authoritative CRDT content model', () => {
  let app: TestApp;
  let owner: TestAgent;
  let workspaceId: string;
  let documentId: string;

  beforeAll(async () => {
    app = await createTestApp();
    owner = await registerOwner(app.server);

    const ws = await owner.post('/workspaces').send({ name: 'Content WS' }).expect(201);
    workspaceId = ws.body.id;

    const doc = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        type: 'FILE',
        name: 'note.md',
        path: 'note.md',
        language: 'markdown',
        content: 'CHECKPOINT_BASE',
      })
      .expect(201);
    documentId = doc.body.id;
  }, 60_000);

  afterAll(async () => {
    app.app.get(DocumentManagerService).destroyAll();
    await cleanupByEmailPrefix(app.prisma, PREFIX);
    await app.app.close();
  });

  it('checkpoints CRDT text and keeps PATCH content closed', async () => {
    const manager = app.app.get(DocumentManagerService);
    const persistence = app.app.get(DocumentPersistenceService);

    const ydoc = await manager.acquire(documentId);
    const generation = manager.getGeneration(documentId) ?? 0;
    ydoc.getText('content').insert(ydoc.getText('content').length, '+LIVE');
    await persistence.persistUpdate(
      documentId,
      Y.encodeStateAsUpdate(ydoc),
      generation,
      'content-model-upd-1',
    );
    await persistence.flushDocument(documentId);

    // Unsaved collaborative text is not yet the REST checkpoint.
    const before = await app.prisma.document.findUnique({ where: { id: documentId } });
    expect(before?.content).toBe('CHECKPOINT_BASE');

    await owner
      .patch(`/documents/${documentId}`)
      .send({ content: 'HACKED_VIA_PATCH' })
      .expect(400);

    const checkpoint = await owner
      .post(`/documents/${documentId}/checkpoint`)
      .expect(201);

    expect(checkpoint.body.content).toContain('CHECKPOINT_BASE');
    expect(checkpoint.body.content).toContain('+LIVE');
    expect(checkpoint.body.versionCreated).toBe(true);

    const after = await app.prisma.document.findUnique({ where: { id: documentId } });
    expect(after?.content).toBe(checkpoint.body.content);

    const zipRes = await owner
      .get(`/workspaces/${workspaceId}/export`)
      .responseType('blob')
      .expect(200);

    const zip = await JSZip.loadAsync(zipRes.body as Buffer);
    const note = await zip.file('note.md')?.async('string');
    expect(note).toBe(checkpoint.body.content);
    expect(note).toContain('+LIVE');

    manager.release(documentId);
  }, 30_000);
});
