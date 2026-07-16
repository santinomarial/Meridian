import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Prisma, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RealtimeAuthorizationService } from '../realtime-authorization/realtime-authorization.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_USER: User = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$placeholder$placeholder',
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const STRONG_PASSWORD = 'Test@1234!';

const MOCK_TOKEN = 'signed.jwt.token';
const MOCK_EXP = Math.floor(Date.now() / 1000) + 900;

function makeRes(): DeepMockProxy<Response> {
  return mockDeep<Response>();
}

function makeService() {
  const prisma = mockDeep<PrismaService>();
  const transaction = mockDeep<Prisma.TransactionClient>();
  const jwtService = mockDeep<JwtService>();
  const mailService = mockDeep<MailService>();
  const realtimeAuthorization = mockDeep<RealtimeAuthorizationService>();
  const configService = mockDeep<ConfigService>();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  jwtService.sign.mockReturnValue(MOCK_TOKEN);
  jwtService.decode.mockReturnValue({
    sub: 'user-1',
    email: 'alice@example.com',
    jti: 'test-jti',
    exp: MOCK_EXP,
  } as never);

  configService.getOrThrow.mockReturnValue({
    clientOrigin: 'http://localhost:5173',
    forgotPasswordTtlMinutes: 30,
  } as never);

  prisma.session.create.mockResolvedValue({} as never);
  realtimeAuthorization.invalidateSession.mockResolvedValue(undefined);
  realtimeAuthorization.invalidateUser.mockResolvedValue(undefined);
  (prisma.$transaction as unknown as jest.Mock).mockImplementation(
    async (callback: (tx: DeepMockProxy<Prisma.TransactionClient>) => Promise<unknown>) =>
      callback(transaction),
  );

  const service = new AuthService(
    prisma,
    jwtService,
    mailService,
    configService,
    realtimeAuthorization,
    logger as never,
  );

  return {
    service,
    prisma,
    transaction,
    jwtService,
    mailService,
    realtimeAuthorization,
  };
}

function makeTokenRecord(overrides?: Partial<{
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>) {
  return {
    id: 'token-1',
    userId: 'user-1',
    tokenHash: createHash('sha256').update('valid-raw-token').digest('hex'),
    expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    usedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  describe('register', () => {
    it('creates user and session, returns safe user and token', async () => {
      const { service, prisma } = makeService();
      const res = makeRes();

      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(BASE_USER);

      const result = await service.register(
        { email: 'alice@example.com', password: STRONG_PASSWORD, displayName: 'Alice' },
        res as never,
      );

      expect(result.user.id).toBe('user-1');
      expect(result.user.email).toBe('alice@example.com');
      expect(result.token).toBe(MOCK_TOKEN);
      expect(Object.keys(result.user)).not.toContain('passwordHash');
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when email is already in use', async () => {
      const { service, prisma } = makeService();
      const res = makeRes();

      prisma.user.findUnique.mockResolvedValue(BASE_USER);

      await expect(
        service.register(
          { email: 'alice@example.com', password: STRONG_PASSWORD, displayName: 'Alice' },
          res as never,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('sets the httpOnly auth_token cookie', async () => {
      const { service, prisma } = makeService();
      const res = makeRes();

      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(BASE_USER);

      await service.register(
        { email: 'alice@example.com', password: STRONG_PASSWORD, displayName: 'Alice' },
        res as never,
      );

      expect(res.cookie).toHaveBeenCalledWith(
        'auth_token',
        MOCK_TOKEN,
        expect.objectContaining({ httpOnly: true }),
      );
    });
  });

  describe('login', () => {
    it('returns safe user and token for valid credentials', async () => {
      const { service, prisma } = makeService();
      const res = makeRes();

      const realHash = await argon2.hash(STRONG_PASSWORD, { type: argon2.argon2id });
      prisma.user.findUnique.mockResolvedValue({ ...BASE_USER, passwordHash: realHash });

      const result = await service.login(
        { email: 'alice@example.com', password: STRONG_PASSWORD },
        res as never,
      );

      expect(result.user.id).toBe('user-1');
      expect(result.token).toBe(MOCK_TOKEN);
      expect(Object.keys(result.user)).not.toContain('passwordHash');
    });

    it('throws UnauthorizedException for unknown email', async () => {
      const { service, prisma } = makeService();
      const res = makeRes();

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: STRONG_PASSWORD }, res as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      const { service, prisma } = makeService();
      const res = makeRes();

      const realHash = await argon2.hash('correctpassword', { type: argon2.argon2id });
      prisma.user.findUnique.mockResolvedValue({ ...BASE_USER, passwordHash: realHash });

      await expect(
        service.login({ email: 'alice@example.com', password: 'wrongpassword' }, res as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const { service, prisma, realtimeAuthorization } = makeService();
      const res = makeRes();

      prisma.session.update.mockResolvedValue({} as never);

      await service.logout('jti-abc', res as never);

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { jti: 'jti-abc' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) as Date }),
      });
      expect(res.clearCookie).toHaveBeenCalledWith(
        'auth_token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(realtimeAuthorization.invalidateSession).toHaveBeenCalledWith(
        'jti-abc',
      );
    });
  });

  // ── forgotPassword ──────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('returns without error when the email does not exist (no user enumeration)', async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'ghost@example.com' }),
      ).resolves.toEqual({});

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('creates a token and calls mailService when the user exists', async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(BASE_USER);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 } as never);
      prisma.passwordResetToken.create.mockResolvedValue({} as never);
      mailService.sendPasswordResetEmail.mockResolvedValue({ delivered: true });

      await expect(
        service.forgotPassword({ email: 'alice@example.com' }),
      ).resolves.toEqual({});

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);

      // The stored hash must differ from the raw token sent via email
      const createArgs = (prisma.passwordResetToken.create as jest.Mock).mock
        .calls[0]![0] as { data: { tokenHash: string } };
      const mailArgs = (mailService.sendPasswordResetEmail as jest.Mock).mock.calls[0] as [
        string,
        string,
      ];
      const resetUrl = mailArgs[1]!;
      const rawToken = resetUrl.split('/').pop()!;
      const expectedHash = createHash('sha256').update(rawToken).digest('hex');

      expect(createArgs.data.tokenHash).toBe(expectedHash);
    });

    it('returns previewResetUrl when mail is in dev-preview mode', async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(BASE_USER);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 } as never);
      prisma.passwordResetToken.create.mockResolvedValue({} as never);
      mailService.sendPasswordResetEmail.mockResolvedValue({
        delivered: false,
        previewUrl: 'http://localhost:5173/reset-password/abc',
        reason: 'no_provider',
      });

      await expect(
        service.forgotPassword({ email: 'alice@example.com' }),
      ).resolves.toEqual({
        previewResetUrl: 'http://localhost:5173/reset-password/abc',
      });
    });

    it('invalidates existing unused tokens before creating a new one', async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(BASE_USER);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.passwordResetToken.create.mockResolvedValue({} as never);
      mailService.sendPasswordResetEmail.mockResolvedValue({ delivered: true });

      await service.forgotPassword({ email: 'alice@example.com' });

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1', usedAt: null }) }),
      );
    });

    it('does not propagate mail errors (user existence stays hidden)', async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(BASE_USER);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 } as never);
      prisma.passwordResetToken.create.mockResolvedValue({} as never);
      mailService.sendPasswordResetEmail.mockRejectedValue(new Error('SMTP down'));

      await expect(
        service.forgotPassword({ email: 'alice@example.com' }),
      ).resolves.toEqual({});
    });
  });

  // ── resetPassword ───────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('atomically consumes the token, updates the password, and revokes every session', async () => {
      const { service, prisma, transaction, realtimeAuthorization } =
        makeService();
      const record = makeTokenRecord();

      prisma.passwordResetToken.findUnique.mockResolvedValue(record as never);
      transaction.passwordResetToken.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 2 });
      transaction.user.update.mockResolvedValue(BASE_USER);
      transaction.session.updateMany.mockResolvedValue({ count: 3 });

      await service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(transaction.passwordResetToken.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: 'token-1',
          userId: 'user-1',
          usedAt: null,
          expiresAt: { gt: expect.any(Date) as Date },
        },
        data: { usedAt: expect.any(Date) as Date },
      });
      expect(transaction.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          passwordHash: expect.stringMatching(/^\$argon2id/) as string,
        }),
      });
      expect(transaction.passwordResetToken.updateMany).toHaveBeenNthCalledWith(2, {
        where: { userId: 'user-1', id: { not: 'token-1' }, usedAt: null },
        data: { usedAt: expect.any(Date) as Date },
      });
      expect(transaction.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
      expect(realtimeAuthorization.invalidateUser).toHaveBeenCalledWith(
        'user-1',
      );
    });

    it('rejects a token lost to a concurrent reset before changing the password', async () => {
      const { service, prisma, transaction } = makeService();
      prisma.passwordResetToken.findUnique.mockResolvedValue(makeTokenRecord() as never);
      transaction.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD }),
      ).rejects.toThrow(BadRequestException);

      expect(transaction.user.update).not.toHaveBeenCalled();
      expect(transaction.session.updateMany).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an unknown token', async () => {
      const { service, prisma } = makeService();
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'bad-token', password: STRONG_PASSWORD }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an expired token', async () => {
      const { service, prisma } = makeService();
      const expired = makeTokenRecord({ expiresAt: new Date(Date.now() - 1_000) });
      prisma.passwordResetToken.findUnique.mockResolvedValue(expired as never);

      await expect(
        service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an already-used token', async () => {
      const { service, prisma } = makeService();
      const used = makeTokenRecord({ usedAt: new Date(Date.now() - 1_000) });
      prisma.passwordResetToken.findUnique.mockResolvedValue(used as never);

      await expect(
        service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cannot reuse a token after a successful reset', async () => {
      const { service, prisma, transaction } = makeService();

      // First call: token is valid
      const record = makeTokenRecord();
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce(record as never);
      transaction.passwordResetToken.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      transaction.user.update.mockResolvedValue(BASE_USER);
      transaction.session.updateMany.mockResolvedValue({ count: 1 });

      await service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD });

      // Second call: token is now "used" (simulate what the DB would return)
      const usedRecord = makeTokenRecord({ usedAt: new Date() });
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce(usedRecord as never);

      await expect(
        service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── E2E reset-token helper ─────────────────────────────────────────────────

  describe('generateResetTokenForE2E', () => {
    it('rejects non-test accounts before querying the database', async () => {
      const { service, prisma } = makeService();

      await expect(
        service.generateResetTokenForE2E('alice@example.com'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('invalidates old tokens and creates the replacement atomically', async () => {
      const { service, prisma, transaction } = makeService();
      const testUser = {
        ...BASE_USER,
        email: 'e2e-reset-user@example.com',
      };
      prisma.user.findUnique.mockResolvedValue(testUser);
      transaction.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      transaction.passwordResetToken.create.mockResolvedValue({} as never);

      const result = await service.generateResetTokenForE2E(testUser.email);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: testUser.email },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(transaction.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: testUser.id, usedAt: null },
        data: { usedAt: expect.any(Date) as Date },
      });
      expect(transaction.passwordResetToken.create).toHaveBeenCalledWith({
        data: {
          userId: testUser.id,
          tokenHash: createHash('sha256').update(result.token).digest('hex'),
          expiresAt: expect.any(Date) as Date,
        },
      });
      expect(result.resetUrl).toBe(
        `http://localhost:5173/reset-password/${result.token}`,
      );
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });
  });
});
