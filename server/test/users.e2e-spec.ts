import request from 'supertest';
import {
  cleanupByEmailPrefix,
  createTestApp,
  STRONG_PASSWORD,
  type TestApp,
  uniqueEmail,
} from './utils/test-app';

const PREFIX = 'int-user-delete-';

describe('User account deletion (HTTP integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, PREFIX);
    await ctx.app.close();
  });

  it('deletes an owner account and all of its owned workspace data atomically', async () => {
    const agent = request.agent(ctx.server);
    const email = uniqueEmail(PREFIX);
    const registration = await agent
      .post('/auth/register')
      .send({ email, password: STRONG_PASSWORD, displayName: 'Delete Me' })
      .expect(201);
    const userId = registration.body.user.id as string;
    const workspace = await agent
      .post('/workspaces')
      .send({ name: 'Disposable workspace' })
      .expect(201);
    const workspaceId = workspace.body.id as string;

    await agent.delete(`/users/${userId}`).expect(204);

    const [deletedUser, deletedWorkspace] = await Promise.all([
      ctx.prisma.user.findUnique({ where: { id: userId } }),
      ctx.prisma.workspace.findUnique({ where: { id: workspaceId } }),
    ]);
    expect(deletedUser).toBeNull();
    expect(deletedWorkspace).toBeNull();
    await agent.get('/auth/me').expect(401);
  });
});
