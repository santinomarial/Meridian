import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import {
  createTestApp,
  cleanupByEmailPrefix,
  uniqueEmail,
  STRONG_PASSWORD,
  type TestApp,
} from './utils/test-app';

const PREFIX = 'int-doc-';

/** Registers a user and returns a cookie-bearing agent + the user's id. */
async function registerAgent(
  server: TestApp['server'],
  displayName: string,
): Promise<{ agent: TestAgent; userId: string }> {
  const agent = request.agent(server);
  const res = await agent
    .post('/auth/register')
    .send({ email: uniqueEmail(PREFIX), password: STRONG_PASSWORD, displayName })
    .expect(201);
  return { agent, userId: res.body.user.id as string };
}

describe('Documents & workspace permissions (HTTP integration)', () => {
  let ctx: TestApp;
  let owner: TestAgent;
  let viewer: TestAgent;
  let nonMember: TestAgent;
  let workspaceId: string;
  let sourceFolderId: string;
  let documentId: string;

  beforeAll(async () => {
    ctx = await createTestApp();

    const ownerReg = await registerAgent(ctx.server, 'Owner');
    owner = ownerReg.agent;

    const ws = await owner.post('/workspaces').send({ name: 'Integration WS' }).expect(201);
    workspaceId = ws.body.id;

    const sourceFolder = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({ type: 'FOLDER', name: 'src', path: 'src' })
      .expect(201);
    sourceFolderId = sourceFolder.body.id;

    const doc = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        parentId: sourceFolderId,
        type: 'FILE',
        name: 'main.py',
        path: 'src/main.py',
        content: 'print("hi")',
      })
      .expect(201);
    documentId = doc.body.id;

    const viewerReg = await registerAgent(ctx.server, 'Viewer');
    viewer = viewerReg.agent;
    await owner
      .post(`/workspaces/${workspaceId}/members`)
      .send({ userId: viewerReg.userId, role: 'VIEWER' })
      .expect(201);

    nonMember = (await registerAgent(ctx.server, 'Outsider')).agent;
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, PREFIX);
    await ctx.app.close();
  });

  // ── Read access ──────────────────────────────────────────────────────────

  it('lets a member (viewer) read a document', async () => {
    const res = await viewer.get(`/documents/${documentId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ path: 'src/main.py', content: 'print("hi")' });
  });

  it('hides a document from a non-member (404, not 403)', async () => {
    const res = await nonMember.get(`/documents/${documentId}`);
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    await request(ctx.server).get(`/documents/${documentId}`).expect(401);
  });

  // ── Write permission enforcement ───────────────────────────────────────────

  it('forbids a viewer from modifying a document (403)', async () => {
    const res = await viewer.patch(`/documents/${documentId}`).send({ content: 'hacked' });
    expect(res.status).toBe(403);
    // The content is unchanged in the DB.
    const doc = await ctx.prisma.document.findUnique({ where: { id: documentId } });
    expect(doc?.content).toBe('print("hi")');
  });

  it('lets the owner modify a document (200)', async () => {
    const res = await owner.patch(`/documents/${documentId}`).send({ content: 'print("updated")' });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('print("updated")');
  });

  it('rejects unknown fields on create (400 via ValidationPipe)', async () => {
    const res = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({ type: 'FILE', name: 'x.txt', path: 'x.txt', bogusField: true });
    expect(res.status).toBe(400);
  });

  it('rejects cross-workspace parents and file parents', async () => {
    const secondWorkspace = await owner
      .post('/workspaces')
      .send({ name: 'Other Integration WS' })
      .expect(201);
    const otherFolder = await owner
      .post(`/workspaces/${secondWorkspace.body.id}/documents`)
      .send({ type: 'FOLDER', name: 'other', path: 'other' })
      .expect(201);

    await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        parentId: otherFolder.body.id,
        type: 'FILE',
        name: 'cross.txt',
        path: 'other/cross.txt',
      })
      .expect(400);

    await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        parentId: documentId,
        type: 'FILE',
        name: 'child.txt',
        path: 'src/main.py/child.txt',
      })
      .expect(400);
  });

  it('rejects self/cyclic moves and rewrites every path on folder rename', async () => {
    const tree = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({ type: 'FOLDER', name: 'tree', path: 'tree' })
      .expect(201);
    const nested = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        parentId: tree.body.id,
        type: 'FOLDER',
        name: 'nested',
        path: 'tree/nested',
      })
      .expect(201);
    const leaf = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        parentId: nested.body.id,
        type: 'FILE',
        name: 'leaf.txt',
        path: 'tree/nested/leaf.txt',
      })
      .expect(201);

    await owner
      .patch(`/documents/${tree.body.id}`)
      .send({ parentId: tree.body.id })
      .expect(400);
    await owner
      .patch(`/documents/${tree.body.id}`)
      .send({ parentId: nested.body.id })
      .expect(400);

    const renamed = await owner
      .patch(`/documents/${tree.body.id}`)
      .send({ name: 'renamed-tree', path: 'renamed-tree' })
      .expect(200);
    expect(renamed.body.path).toBe('renamed-tree');

    const [storedNested, storedLeaf] = await Promise.all([
      ctx.prisma.document.findUnique({ where: { id: nested.body.id } }),
      ctx.prisma.document.findUnique({ where: { id: leaf.body.id } }),
    ]);
    expect(storedNested?.path).toBe('renamed-tree/nested');
    expect(storedLeaf?.path).toBe('renamed-tree/nested/leaf.txt');
  });

  // ── Workspace export ───────────────────────────────────────────────────────

  it('exports the workspace as a real ZIP with the right headers (member)', async () => {
    // responseType('blob') buffers the binary body into a Buffer in Node.
    const res = await owner.get(`/workspaces/${workspaceId}/export`).responseType('blob');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*\.zip"/);
    // ZIP magic bytes "PK".
    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(0);
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('does not let a non-member export the workspace (404)', async () => {
    const res = await nonMember.get(`/workspaces/${workspaceId}/export`);
    expect(res.status).toBe(404);
  });
});
