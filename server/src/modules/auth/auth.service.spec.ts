import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { User } from '@prisma/client';
import * as argon2 from 'argon2';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

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

const MOCK_TOKEN = 'signed.jwt.token';
// exp = current time + 900s (15 min)
const MOCK_EXP = Math.floor(Date.now() / 1000) + 900;

function makeRes(): DeepMockProxy<Response> {
  return mockDeep<Response>();
}

function makeService() {
  const prisma = mockDeep<PrismaService>();
  const jwtService = mockDeep<JwtService>();
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

  prisma.session.create.mockResolvedValue({} as never);

  const service = new AuthService(prisma, jwtService, logger as never);

  return { service, prisma, jwtService };
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
        { email: 'alice@example.com', password: 'password123', displayName: 'Alice' },
        res as never,
      );

      expect(result.user.id).toBe('user-1');
      expect(result.user.email).toBe('alice@example.com');
      expect(result.token).toBe(MOCK_TOKEN);
      // passwordHash must never be returned
      expect(Object.keys(result.user)).not.toContain('passwordHash');
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when email is already in use', async () => {
      const { service, prisma } = makeService();
      const res = makeRes();

      prisma.user.findUnique.mockResolvedValue(BASE_USER);

      await expect(
        service.register(
          { email: 'alice@example.com', password: 'password123', displayName: 'Alice' },
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
        { email: 'alice@example.com', password: 'pass12345', displayName: 'Alice' },
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

      const realHash = await argon2.hash('password123', { type: argon2.argon2id });
      prisma.user.findUnique.mockResolvedValue({ ...BASE_USER, passwordHash: realHash });

      const result = await service.login(
        { email: 'alice@example.com', password: 'password123' },
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
        service.login({ email: 'ghost@example.com', password: 'password123' }, res as never),
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
});
