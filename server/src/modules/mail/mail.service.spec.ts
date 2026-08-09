import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import type { AppConfig } from '../../config/configuration.type';

function makeService(configOverrides: Partial<AppConfig> = {}) {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({
      nodeEnv: 'production',
      resendApiKey: 're_test_key',
      mailFrom: 'Meridian <accounts@example.com>',
      mailTimeoutMs: 100,
      forgotPasswordTtlMinutes: 30,
      emailVerificationTtlMinutes: 1440,
      ...configOverrides,
    }),
  };
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    service: new MailService(
      configService as unknown as ConfigService,
      logger as never,
    ),
    logger,
  };
}

describe('MailService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delivers through Resend with an abort signal', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    const { service } = makeService();

    await expect(
      service.sendPasswordResetEmail(
        'alice@example.com',
        'https://app.example.com/reset-password/token',
      ),
    ).resolves.toEqual({ delivered: true });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    );
  });

  it('returns a bounded provider failure when the network rejects', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unavailable'));
    const { service, logger } = makeService();

    const result = await service.sendEmailVerificationEmail(
      'alice@example.com',
      'Alice',
      'https://app.example.com/verify-email/token',
    );

    expect(result).toMatchObject({
      delivered: false,
      reason: 'provider_rejected',
      detail: 'network unavailable',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'network unavailable' }),
      'Resend request failed',
    );
  });

  it('aborts a stalled provider request at MAIL_TIMEOUT_MS', async () => {
    jest.spyOn(global, 'fetch').mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          reject(new Error('missing abort signal'));
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
    });
    const { service, logger } = makeService({ mailTimeoutMs: 10 });

    const result = await service.sendWorkspaceInviteEmail(
      'alice@example.com',
      'Bob',
      'Project',
      'https://app.example.com/invites/token',
    );

    expect(result).toMatchObject({
      delivered: false,
      reason: 'provider_rejected',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 10 }),
      'Resend request failed',
    );
  });
});
