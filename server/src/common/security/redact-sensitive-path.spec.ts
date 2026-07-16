import { redactSensitivePath } from './redact-sensitive-path';

describe('redactSensitivePath', () => {
  it('redacts invite bearer tokens in the path', () => {
    expect(redactSensitivePath('/invites/super-secret-token/accept')).toBe(
      '/invites/[REDACTED]/accept',
    );
  });

  it('redacts reset-password tokens in the path', () => {
    expect(redactSensitivePath('/reset-password/abc123?x=1')).toBe(
      '/reset-password/[REDACTED]?x=1',
    );
  });

  it('redacts token query parameters', () => {
    expect(redactSensitivePath('/auth/reset?token=abc&other=1')).toBe(
      '/auth/reset?token=[REDACTED]&other=1',
    );
  });
});
