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
      RESEND_API_KEY: 're_production_key',
      MAIL_FROM: 'Meridian <accounts@example.com>',
    });
    expect(env.E2E_TEST).toBe('false');
  });

  it('requires email verification and a verified mail sender in production', () => {
    expect(() =>
      validateEnv({
        ...REQUIRED_ENV,
        NODE_ENV: 'production',
        EMAIL_VERIFICATION_REQUIRED: 'false',
      }),
    ).toThrow(/EMAIL_VERIFICATION_REQUIRED cannot be disabled/);

    expect(() =>
      validateEnv({
        ...REQUIRED_ENV,
        NODE_ENV: 'production',
        MAIL_FROM: 'Meridian <accounts@example.com>',
      }),
    ).toThrow(/RESEND_API_KEY is required/);

    expect(() =>
      validateEnv({
        ...REQUIRED_ENV,
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_production_key',
        MAIL_FROM: 'Meridian <onboarding@resend.dev>',
      }),
    ).toThrow(/MAIL_FROM must use a verified production mail domain/);
  });

  it('rejects ENABLE_TERMINAL=true in production', () => {
    expect(() =>
      validateEnv({
        ...REQUIRED_ENV,
        NODE_ENV: 'production',
        ENABLE_TERMINAL: 'true',
      }),
    ).toThrow(/ENABLE_TERMINAL cannot be enabled in production/);
  });

  it('parses TRUST_PROXY hop counts', () => {
    expect(
      validateEnv({ ...REQUIRED_ENV, TRUST_PROXY: '1' }).TRUST_PROXY,
    ).toBe(1);
    expect(
      validateEnv({ ...REQUIRED_ENV, TRUST_PROXY: 'true' }).TRUST_PROXY,
    ).toBe(true);
  });

  it('normalizes REDIS_KEY_PREFIX with a trailing colon', () => {
    expect(
      validateEnv({ ...REQUIRED_ENV, REDIS_KEY_PREFIX: 'prod' }).REDIS_KEY_PREFIX,
    ).toBe('prod:');
    expect(
      validateEnv({ ...REQUIRED_ENV, REDIS_KEY_PREFIX: 'staging:' }).REDIS_KEY_PREFIX,
    ).toBe('staging:');
  });

  it('parses REDIS_REQUIRED', () => {
    expect(
      validateEnv({ ...REQUIRED_ENV, REDIS_REQUIRED: 'true' }).REDIS_REQUIRED,
    ).toBe(true);
  });
});
