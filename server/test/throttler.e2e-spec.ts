import request from 'supertest';
import { cleanupByEmailPrefix, createTestApp, STRONG_PASSWORD, uniqueEmail, type TestApp } from './utils/test-app';

const AUTH_LIMIT = 3;
const HTTP_LIMIT = 6;
const PREFIX = 'int-throttle-session-';

describe('Rate limiting (HTTP integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    // Tighten the auth throttler for this app only. The limit is read into the
    // ThrottlerModule at module-build time, so restoring the env right after
    // build keeps it from leaking into other test files' apps.
    const prev = process.env['AUTH_LIMIT'];
    const prevHttp = process.env['HTTP_LIMIT'];
    process.env['AUTH_LIMIT'] = String(AUTH_LIMIT);
    process.env['HTTP_LIMIT'] = String(HTTP_LIMIT);
    try {
      ctx = await createTestApp();
    } finally {
      if (prev === undefined) delete process.env['AUTH_LIMIT'];
      else process.env['AUTH_LIMIT'] = prev;
      if (prevHttp === undefined) delete process.env['HTTP_LIMIT'];
      else process.env['HTTP_LIMIT'] = prevHttp;
    }
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, PREFIX);
    await ctx.app.close();
  });

  it('allows session refreshes beyond the sign-in budget while retaining the HTTP limit', async () => {
    const agent = request.agent(ctx.server);
    const email = uniqueEmail(PREFIX);
    await agent.post('/auth/register').send({
      email, password: STRONG_PASSWORD, displayName: 'Session refresh',
    }).expect(201);

    for (let i = 0; i < HTTP_LIMIT; i++) {
      const me = await agent.get('/auth/me').expect(200);
      expect(me.body.email).toBe(email);
      expect(me.body.capabilities).toEqual({ terminal: false });
    }
    await agent.get('/auth/me').expect(429);
  });

  it('keeps logout available after rejected requests exceed the sign-in budget', async () => {
    for (let i = 0; i < AUTH_LIMIT + 1; i++) {
      await request(ctx.server).post('/auth/logout').expect(401);
    }
    const agent = request.agent(ctx.server);
    await agent.post('/auth/register').send({
      email: uniqueEmail(PREFIX), password: STRONG_PASSWORD, displayName: 'Logout',
    }).expect(201);
    await agent.post('/auth/logout').expect(204);
  });

  it('returns 429 once the auth rate limit is exceeded', async () => {
    const attempt = () =>
      request(ctx.server)
        .post('/auth/login')
        .send({ email: 'int-throttle@example.com', password: 'whatever-123' });

    const statuses: number[] = [];
    for (let i = 0; i < AUTH_LIMIT + 1; i++) {
      // Sequential so the throttler counts them deterministically.
      const res = await attempt();
      statuses.push(res.status);
    }

    // The first requests are processed (401 — no such user); the one past the
    // limit is rejected by the ThrottlerGuard before reaching the handler.
    expect(statuses.slice(0, AUTH_LIMIT)).toContain(401);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
