import request from 'supertest';
import {
  cleanupByEmailPrefix,
  createTestApp,
  STRONG_PASSWORD,
  uniqueEmail,
  type TestApp,
} from './utils/test-app';

const E2E_PREFIX = 'e2e-';
const NON_TEST_PREFIX = 'safety-user-';

describe('E2E-only HTTP surfaces', () => {
  let ctx: TestApp;
  const originalE2eTest = process.env['E2E_TEST'];
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['E2E_TEST'] = 'true';
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanupByEmailPrefix(ctx.prisma, E2E_PREFIX);
    await cleanupByEmailPrefix(ctx.prisma, NON_TEST_PREFIX);
    await ctx.app.close();
    restoreEnv('E2E_TEST', originalE2eTest);
    restoreEnv('NODE_ENV', originalNodeEnv);
  });

  afterEach(() => {
    process.env['NODE_ENV'] = 'test';
    process.env['E2E_TEST'] = 'true';
  });

  it('returns 404 before body validation when E2E_TEST is disabled', async () => {
    process.env['E2E_TEST'] = 'false';
    await request(ctx.server).post('/e2e/cleanup').send({}).expect(404);
    await request(ctx.server)
      .post('/auth/e2e/password-reset-token')
      .send({})
      .expect(404);
  });

  it('returns 404 when production mode is forced at runtime', async () => {
    process.env['NODE_ENV'] = 'production';
    await request(ctx.server)
      .post('/e2e/cleanup')
      .send({ emailPrefix: E2E_PREFIX })
      .expect(404);
  });

  it('rejects missing, empty, and arbitrary cleanup prefixes', async () => {
    await request(ctx.server).post('/e2e/cleanup').send({}).expect(400);
    await request(ctx.server)
      .post('/e2e/cleanup')
      .send({ emailPrefix: '' })
      .expect(400);
    await request(ctx.server)
      .post('/e2e/cleanup')
      .send({ emailPrefix: 'safety-user-' })
      .expect(400);
  });

  it('uses POST body data and rejects arbitrary reset-token accounts', async () => {
    const email = uniqueEmail(NON_TEST_PREFIX);
    await request(ctx.server)
      .post('/auth/register')
      .send({ email, password: STRONG_PASSWORD, displayName: 'Safety User' })
      .expect(201);

    await request(ctx.server)
      .get(`/auth/e2e/password-reset-token?email=${encodeURIComponent(email)}`)
      .expect(404);
    await request(ctx.server)
      .post('/auth/e2e/password-reset-token')
      .send({ email })
      .expect(400);
  });

  it('issues a token for a synthetic account and cleanup preserves other users', async () => {
    const testEmail = uniqueEmail(E2E_PREFIX);
    const nonTestEmail = uniqueEmail(NON_TEST_PREFIX);
    await request(ctx.server)
      .post('/auth/register')
      .send({
        email: testEmail,
        password: STRONG_PASSWORD,
        displayName: 'E2E User',
      })
      .expect(201);
    await request(ctx.server)
      .post('/auth/register')
      .send({
        email: nonTestEmail,
        password: STRONG_PASSWORD,
        displayName: 'Non-test User',
      })
      .expect(201);

    const tokenResponse = await request(ctx.server)
      .post('/auth/e2e/password-reset-token')
      .send({ email: testEmail })
      .expect(200);
    expect(tokenResponse.body).toEqual({
      token: expect.stringMatching(/^[a-f0-9]{64}$/) as string,
      resetUrl: expect.stringMatching(/\/reset-password\/[a-f0-9]{64}$/) as string,
    });

    const cleanupResponse = await request(ctx.server)
      .post('/e2e/cleanup')
      .send({ emailPrefix: E2E_PREFIX })
      .expect(200);
    expect(cleanupResponse.body.deletedUsers).toBeGreaterThanOrEqual(1);

    await expect(
      ctx.prisma.user.findUnique({ where: { email: nonTestEmail } }),
    ).resolves.not.toBeNull();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
