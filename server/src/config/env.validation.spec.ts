import { validateEnv } from './env.validation';

const REQUIRED_ENV = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_SECRET: 'test-secret-at-least-sixteen-characters',
};

describe('environment validation', () => {
  it('rejects E2E_TEST=true in production', () => {
    expect(() =>
      validateEnv({
        ...REQUIRED_ENV,
        NODE_ENV: 'production',
        E2E_TEST: 'true',
      }),
    ).toThrow(/E2E_TEST cannot be enabled in production/);
  });

  it('allows production when E2E helpers are disabled', () => {
    const env = validateEnv({
      ...REQUIRED_ENV,
      NODE_ENV: 'production',
      E2E_TEST: 'false',
    });
    expect(env.E2E_TEST).toBe('false');
  });

  it('allows E2E helpers in test and development processes', () => {
    expect(
      validateEnv({ ...REQUIRED_ENV, NODE_ENV: 'test', E2E_TEST: 'true' })
        .E2E_TEST,
    ).toBe('true');
    expect(
      validateEnv({
        ...REQUIRED_ENV,
        NODE_ENV: 'development',
        E2E_TEST: 'true',
      }).E2E_TEST,
    ).toBe('true');
  });
});
