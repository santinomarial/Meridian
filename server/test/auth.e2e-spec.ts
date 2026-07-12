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

  // ── Expired / stale sessions (long-idle behavior) ───────────────────────────

  it('/auth/me with an invalid cookie returns 401 (not 500) and clears the cookie', async () => {
    const res = await request(ctx.server)
      .get('/auth/me')
      .set('Cookie', 'auth_token=this-is-not-a-jwt');

    expect(res.status).toBe(401);
    // The stale cookie must be cleared so the browser stops sending it.
    const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const cleared = setCookie.find((c) => c.startsWith('auth_token='));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/auth_token=;|Expires=Thu, 01 Jan 1970/);
  });

  it('/auth/me with a structurally-valid but expired/forged token returns 401, not 500', async () => {
    // A well-formed JWT signed with the wrong secret.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJ4IiwiZW1haWwiOiJ4QHguY29tIiwianRpIjoieCIsImlhdCI6MSwiZXhwIjoyfQ.' +
      'invalid-signature-here';
    const res = await request(ctx.server)
      .get('/auth/me')
      .set('Cookie', `auth_token=${forged}`);
    expect(res.status).toBe(401);
  });

  it('login succeeds even when a stale/garbage cookie is sent, and sets a fresh cookie', async () => {
    const email = uniqueEmail(PREFIX);
    await request(ctx.server)
      .post('/auth/register')
      .send({ email, password: STRONG_PASSWORD, displayName: 'Dora' })
      .expect(201);

    // Simulate a browser that kept an expired/garbage cookie for weeks.
    const res = await request(ctx.server)
      .post('/auth/login')
      .set('Cookie', 'auth_token=stale-garbage-token')
      .send({ email, password: STRONG_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);

    const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const fresh = setCookie.find(
      (c) => c.startsWith('auth_token=') && !c.startsWith('auth_token=;'),
    );
    expect(fresh).toBeDefined();
    expect(fresh).toContain('HttpOnly');

    // The fresh cookie works for /auth/me.
    const cookieValue = fresh!.split(';')[0]!;
    const me = await request(ctx.server).get('/auth/me').set('Cookie', cookieValue);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it('sessions are long-lived: cookie Max-Age matches the JWT exp and is at least 1 day', async () => {
    const email = uniqueEmail(PREFIX);
    const res = await request(ctx.server)
      .post('/auth/register')
      .send({ email, password: STRONG_PASSWORD, displayName: 'Eve' })
      .expect(201);

    const setCookie = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const authCookie = setCookie.find((c) => c.startsWith('auth_token='));
    expect(authCookie).toBeDefined();

    const maxAgeMatch = /Max-Age=(\d+)/.exec(authCookie!);
    expect(maxAgeMatch).not.toBeNull();
    const maxAgeSeconds = parseInt(maxAgeMatch![1]!, 10);

    // JWT_EXPIRES_IN defaults to 7d; anything under a day would log users out
    // during normal usage gaps.
    expect(maxAgeSeconds).toBeGreaterThanOrEqual(86_400);

    // Cookie lifetime and token exp must agree (within clock-skew tolerance).
    const token = res.body.token as string;
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1]!, 'base64url').toString(),
    ) as { exp: number; iat: number };
    const tokenLifetime = payload.exp - payload.iat;
    expect(Math.abs(tokenLifetime - maxAgeSeconds)).toBeLessThanOrEqual(5);
  });
});
