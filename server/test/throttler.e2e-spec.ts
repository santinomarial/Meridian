import request from 'supertest';
import { createTestApp, type TestApp } from './utils/test-app';

const AUTH_LIMIT = 3;

describe('Rate limiting (HTTP integration)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    // Tighten the auth throttler for this app only. The limit is read into the
    // ThrottlerModule at module-build time, so restoring the env right after
    // build keeps it from leaking into other test files' apps.
    const prev = process.env['AUTH_LIMIT'];
    process.env['AUTH_LIMIT'] = String(AUTH_LIMIT);
    try {
      ctx = await createTestApp();
    } finally {
      if (prev === undefined) delete process.env['AUTH_LIMIT'];
      else process.env['AUTH_LIMIT'] = prev;
    }
  });

  afterAll(async () => {
    await ctx.app.close();
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
