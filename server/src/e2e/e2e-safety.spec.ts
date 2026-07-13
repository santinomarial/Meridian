import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ALLOWED_TEST_EMAIL_PREFIXES,
  assertE2eTestMode,
  assertTestEmail,
  assertTestEmailPrefix,
} from './e2e-safety';

describe('E2E safety boundaries', () => {
  const originalE2eTest = process.env['E2E_TEST'];
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    restoreEnv('E2E_TEST', originalE2eTest);
    restoreEnv('NODE_ENV', originalNodeEnv);
  });

  it('only enables helpers when explicitly requested outside production', () => {
    process.env['NODE_ENV'] = 'test';
    process.env['E2E_TEST'] = 'true';
    expect(() => assertE2eTestMode()).not.toThrow();

    process.env['E2E_TEST'] = 'false';
    expect(() => assertE2eTestMode()).toThrow(NotFoundException);

    process.env['E2E_TEST'] = 'true';
    process.env['NODE_ENV'] = 'production';
    expect(() => assertE2eTestMode()).toThrow(NotFoundException);
  });

  it.each(ALLOWED_TEST_EMAIL_PREFIXES)(
    'accepts the allow-listed cleanup prefix %s',
    (prefix) => {
      expect(assertTestEmailPrefix(prefix)).toBe(prefix);
    },
  );

  it.each([undefined, null, '', 'e2e', 'e2e-run-', 'int-', 'user-'])(
    'rejects an unrecognized cleanup prefix: %p',
    (prefix) => {
      expect(() => assertTestEmailPrefix(prefix)).toThrow(BadRequestException);
    },
  );

  it.each([
    'e2e-12345-abcde@example.com',
    'int-auth-run-1@example.com',
    'int-doc-run-2@example.com',
    'int-throttle-run-3@example.com',
    'int-workspace-owner-run-4@example.com',
  ])('accepts a synthetic test email: %s', (email) => {
    expect(assertTestEmail(email)).toBe(email);
  });

  it.each([
    undefined,
    '',
    'alice@example.com',
    'e2e-user@company.com',
    'e2e-@example.com',
    'E2E-user@example.com',
    'e2e-user@example.com.attacker.test',
  ])('rejects a non-test email: %p', (email) => {
    expect(() => assertTestEmail(email)).toThrow(BadRequestException);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
