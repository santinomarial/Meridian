import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import {
  createTestApp,
  cleanupByEmailPrefix,
  uniqueEmail,
  STRONG_PASSWORD,
  type TestApp,
} from './utils/test-app';

const PREFIX = 'int-workspace-owner-';

async function registerAgent(
  server: TestApp['server'],
  displayName: string,
): Promise<{ agent: TestAgent; userId: string }> {
  const agent = request.agent(server);
  const response = await agent
    .post('/auth/register')
    .send({
      email: uniqueEmail(PREFIX),
      password: STRONG_PASSWORD,
      displayName,
    })
    .expect(201);
  return { agent, userId: response.body.user.id as string };
}

describe('Workspace ownership invariants (HTTP integration)', () => {
  let ctx: TestApp;
  let owner: TestAgent;
  let editor: TestAgent;
  let workspaceId: string;
  let ownerId: string;
  let editorId: string;
  let targetId: string;
  let ownerMemberId: string;
  let editorMemberId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const ownerRegistration = await registerAgent(ctx.server, 'Owner');
    const editorRegistration = await registerAgent(ctx.server, 'Editor');
    const targetRegistration = await registerAgent(ctx.server, 'Target');
    owner = ownerRegistration.agent;
    editor = editorRegistration.agent;
    ownerId = ownerRegistration.userId;
    editorId = editorRegistration.userId;
    targetId = targetRegistration.userId;

    const workspace = await owner
      .post('/workspaces')
      .send({ name: 'Ownership Integration WS' })
      .expect(201);
    workspaceId = workspace.body.id;

    const editorMember = await owner
      .post(`/workspaces/${workspaceId}/members`)
      .send({ userId: editorId, role: 'EDITOR' })
      .expect(201);
    editorMemberId = editorMember.body.id;

    const members = await owner
      .get(`/workspaces/${workspaceId}/members`)
      .expect(200);
    ownerMemberId = members.body.find(
      (member: { userId: string }) => member.userId === ownerId,
    ).id;
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, PREFIX);
    await ctx.app.close();
  });

  it('does not allow OWNER to be assigned through generic member APIs', async () => {
    await owner
      .post(`/workspaces/${workspaceId}/members`)
      .send({ userId: targetId, role: 'OWNER' })
      .expect(400);
    await owner
      .patch(`/workspaces/${workspaceId}/members/${editorMemberId}`)
      .send({ role: 'OWNER' })
      .expect(400);
  });

  it('does not allow the canonical owner membership to be demoted or removed', async () => {
    await owner
      .patch(`/workspaces/${workspaceId}/members/${ownerMemberId}`)
      .send({ role: 'EDITOR' })
      .expect(403);
    await owner
      .delete(`/workspaces/${workspaceId}/members/${ownerMemberId}`)
      .expect(403);

    const [workspace, membership] = await Promise.all([
      ctx.prisma.workspace.findUnique({ where: { id: workspaceId } }),
      ctx.prisma.workspaceMember.findUnique({ where: { id: ownerMemberId } }),
    ]);
    expect(workspace?.ownerId).toBe(ownerId);
    expect(membership).toMatchObject({ userId: ownerId, role: 'OWNER' });
  });

  it('does not trust a malformed extra OWNER membership', async () => {
    await ctx.prisma.workspaceMember.update({
      where: { id: editorMemberId },
      data: { role: 'OWNER' },
    });

    await editor
      .post(`/workspaces/${workspaceId}/members`)
      .send({ userId: targetId, role: 'VIEWER' })
      .expect(403);
    await editor
      .patch(`/workspaces/${workspaceId}`)
      .send({ name: 'Hijacked' })
      .expect(403);

    const workspace = await ctx.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    expect(workspace).toMatchObject({
      name: 'Ownership Integration WS',
      ownerId,
    });
  });
});
