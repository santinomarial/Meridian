import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

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
  const jwtService = mockDeep<JwtService>();
  const mailService = mockDeep<MailService>();
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

  const service = new AuthService(
    prisma,
    jwtService,
    mailService,
    configService,
    logger as never,
  );

  return { service, prisma, jwtService, mailService };
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
      const { service, prisma } = makeService();
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
    });
  });

  // ── forgotPassword ──────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    it('returns without error when the email does not exist (no user enumeration)', async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'ghost@example.com' }),
      ).resolves.toBeUndefined();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('creates a token and calls mailService when the user exists', async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(BASE_USER);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 } as never);
      prisma.passwordResetToken.create.mockResolvedValue({} as never);
      mailService.sendPasswordResetEmail.mockResolvedValue(undefined);

      await service.forgotPassword({ email: 'alice@example.com' });

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

    it('invalidates existing unused tokens before creating a new one', async () => {
      const { service, prisma, mailService } = makeService();

      prisma.user.findUnique.mockResolvedValue(BASE_USER);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.passwordResetToken.create.mockResolvedValue({} as never);
      mailService.sendPasswordResetEmail.mockResolvedValue(undefined);

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
      ).resolves.toBeUndefined();
    });
  });

  // ── resetPassword ───────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('updates the password and marks the token used for a valid request', async () => {
      const { service, prisma } = makeService();
      const record = makeTokenRecord();

      prisma.passwordResetToken.findUnique.mockResolvedValue(record as never);
      prisma.user.update.mockResolvedValue(BASE_USER);
      prisma.passwordResetToken.update.mockResolvedValue({} as never);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 } as never);

      await service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          passwordHash: expect.stringMatching(/^\$argon2id/) as string,
        }),
      });
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'token-1' },
        data: expect.objectContaining({ usedAt: expect.any(Date) as Date }),
      });
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
      const { service, prisma } = makeService();

      // First call: token is valid
      const record = makeTokenRecord();
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce(record as never);
      prisma.user.update.mockResolvedValue(BASE_USER);
      prisma.passwordResetToken.update.mockResolvedValue({} as never);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 } as never);

      await service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD });

      // Second call: token is now "used" (simulate what the DB would return)
      const usedRecord = makeTokenRecord({ usedAt: new Date() });
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce(usedRecord as never);

      await expect(
        service.resetPassword({ token: 'valid-raw-token', password: STRONG_PASSWORD }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
