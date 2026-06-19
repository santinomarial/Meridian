import request from 'supertest';
import {
  createTestApp,
  cleanupByEmailPrefix,
  uniqueEmail,
  STRONG_PASSWORD,
  type TestApp,
} from './utils/test-app';

const PREFIX = 'int-auth-';

describe('Auth (HTTP integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, PREFIX);
    await ctx.app.close();
  });

  // ── ValidationPipe + exception filter ──────────────────────────────────────

  it('rejects a weak password with 400 and the standard error envelope', async () => {
    const res = await request(ctx.server)
      .post('/auth/register')
      .send({ email: uniqueEmail(PREFIX), password: 'weak', displayName: 'Weak' });

    expect(res.status).toBe(400);
    // Shape produced by HttpExceptionFilter.
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      path: '/auth/register',
    });
    expect(typeof res.body.timestamp).toBe('string');
    expect(JSON.stringify(res.body.message).toLowerCase()).toContain('password');
  });

  it('rejects an invalid email with 400', async () => {
    const res = await request(ctx.server)
      .post('/auth/register')
      .send({ email: 'not-an-email', password: STRONG_PASSWORD, displayName: 'Bad' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown fields (forbidNonWhitelisted)', async () => {
    const res = await request(ctx.server)
      .post('/auth/register')
      .send({
        email: uniqueEmail(PREFIX),
        password: STRONG_PASSWORD,
        displayName: 'X',
        isAdmin: true,
      });
    expect(res.status).toBe(400);
  });

  // ── Registration + JwtAuthGuard + session lifecycle ────────────────────────

  it('registers a user, sets an auth cookie, and never leaks the password hash', async () => {
    const email = uniqueEmail(PREFIX);
    const res = await request(ctx.server)
      .post('/auth/register')
      .send({ email, password: STRONG_PASSWORD, displayName: 'Alice' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, displayName: 'Alice' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.token).toBe('string');

    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie?.some((c) => c.startsWith('auth_token='))).toBe(true);
  });

  it('guards /auth/me — 401 without a session', async () => {
    const res = await request(ctx.server).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('register → /auth/me → logout → /auth/me revokes the session', async () => {
    const agent = request.agent(ctx.server);
    const email = uniqueEmail(PREFIX);

    await agent
      .post('/auth/register')
      .send({ email, password: STRONG_PASSWORD, displayName: 'Bob' })
      .expect(201);

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);

    await agent.post('/auth/logout').expect(204);

    // The session was revoked, so the (now-stale) cookie is rejected.
    const after = await agent.get('/auth/me');
    expect(after.status).toBe(401);
  });

  it('rejects login with a wrong password', async () => {
    const email = uniqueEmail(PREFIX);
    await request(ctx.server)
      .post('/auth/register')
      .send({ email, password: STRONG_PASSWORD, displayName: 'Carol' })
      .expect(201);

    const res = await request(ctx.server)
      .post('/auth/login')
      .send({ email, password: 'WrongPass@123!' });
    expect(res.status).toBe(401);
  });
});
