import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import {
  cleanupByEmailPrefix,
  createTestApp,
  STRONG_PASSWORD,
  uniqueEmail,
  type TestApp,
} from './utils/test-app';

const PREFIX = 'int-invite-';

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

describe('Invite acceptance (HTTP integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, PREFIX);
    await ctx.app.close();
  });

  it('allows exactly one membership when two users redeem the same invite concurrently', async () => {
    const owner = await registerAgent(ctx.server, 'Invite Owner');
    const first = await registerAgent(ctx.server, 'First Contender');
    const second = await registerAgent(ctx.server, 'Second Contender');

    const workspace = await owner.agent
      .post('/workspaces')
      .send({ name: 'Concurrent Invite Workspace' })
      .expect(201);
    const created = await owner.agent
      .post(`/workspaces/${workspace.body.id as string}/invites`)
      .send({ role: 'EDITOR' })
      .expect(201);

    const token = created.body.token as string;
    const results = await Promise.all([
      first.agent.post(`/invites/${token}/accept`),
      second.agent.post(`/invites/${token}/accept`),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 410]);
    const contenders = await ctx.prisma.workspaceMember.findMany({
      where: {
        workspaceId: workspace.body.id as string,
        userId: { in: [first.userId, second.userId] },
      },
    });
    expect(contenders).toHaveLength(1);

    const invite = await ctx.prisma.invite.findUnique({
      where: { id: created.body.id as string },
    });
    expect(invite?.acceptedAt).not.toBeNull();
    expect(invite?.tokenHash).not.toBe(token);
    expect(invite?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
