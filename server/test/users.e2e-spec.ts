import request from 'supertest';
import {
  cleanupByEmailPrefix,
  createTestApp,
  STRONG_PASSWORD,
  type TestApp,
  uniqueEmail,
} from './utils/test-app';

const PREFIX = 'int-user-delete-';

describe('User profiles and account deletion (HTTP integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, PREFIX);
    await ctx.app.close();
  });

  it('rejects blank or oversized names at signup without creating an account', async () => {
    const email = uniqueEmail(PREFIX);
    for (const displayName of ['   ', 'A'.repeat(101)]) {
      await request(ctx.server)
        .post('/auth/register')
        .send({ email, password: STRONG_PASSWORD, displayName })
        .expect(400);
    }
    expect(await ctx.prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('validates profile names and persists a trimmed name across session reads', async () => {
    const agent = request.agent(ctx.server);
    const registration = await agent.post('/auth/register').send({
      email: uniqueEmail(PREFIX), password: STRONG_PASSWORD, displayName: 'Original',
    }).expect(201);
    const userId = registration.body.user.id as string;
    for (const displayName of ['', '   ', null, 'A'.repeat(101)]) {
      await agent.patch(`/users/${userId}`).send({ displayName }).expect(400);
      const me = await agent.get('/auth/me').expect(200);
      expect(me.body.displayName).toBe('Original');
    }
    await agent.patch(`/users/${userId}`).send({ displayName: '  New Name  ' }).expect(200);
    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.displayName).toBe('New Name');
    await agent.patch(`/users/${userId}`).send({ avatarUrl: null }).expect(200);
    expect((await agent.get('/auth/me')).body.displayName).toBe('New Name');
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

    const deletion = await agent.delete(`/users/${userId}`).expect(204);
    const setCookie = (deletion.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(setCookie.some((cookie) => cookie.startsWith('auth_token=;'))).toBe(true);

    const [deletedUser, deletedWorkspace] = await Promise.all([
      ctx.prisma.user.findUnique({ where: { id: userId } }),
      ctx.prisma.workspace.findUnique({ where: { id: workspaceId } }),
    ]);
    expect(deletedUser).toBeNull();
    expect(deletedWorkspace).toBeNull();
    await agent.get('/auth/me').expect(401);
  });
});
