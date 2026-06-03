import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { ExecutionContext } from '@nestjs/common';
import type { Session, User } from '@prisma/client';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import type { JwtPayload } from '../../modules/auth/types/auth-user.type';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_USER: User = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  passwordHash: 'hash',
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const VALID_PAYLOAD: JwtPayload = {
  sub: 'user-1',
  email: 'alice@example.com',
  jti: 'jti-abc',
};

const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 3_600_000);

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: 'sess-1',
    userId: 'user-1',
    jti: 'jti-abc',
    expiresAt: FUTURE,
    revokedAt: null,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(req: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function makeGuard() {
  const jwtService = mockDeep<JwtService>();
  const prisma = mockDeep<PrismaService>();
  const guard = new JwtAuthGuard(jwtService, prisma);
  return { guard, jwtService, prisma };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JwtAuthGuard', () => {
  describe('missing token', () => {
    it('throws UnauthorizedException when no cookie and no Authorization header', async () => {
      const { guard } = makeGuard();
      const ctx = makeContext({ cookies: {}, headers: {} });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('invalid token', () => {
    it('throws UnauthorizedException when JwtService.verify throws', async () => {
      const { guard, jwtService } = makeGuard();
      const ctx = makeContext({
        cookies: { auth_token: 'bad-token' },
        headers: {},
      });
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('session not found', () => {
    it('throws UnauthorizedException when no session row exists', async () => {
      const { guard, jwtService, prisma } = makeGuard();
      const ctx = makeContext({
        cookies: { auth_token: 'good-token' },
        headers: {},
      });
      jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
      prisma.session.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('expired session', () => {
    it('throws UnauthorizedException when session.expiresAt is in the past', async () => {
      const { guard, jwtService, prisma } = makeGuard();
      const ctx = makeContext({
        cookies: { auth_token: 'good-token' },
        headers: {},
      });
      jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
      prisma.session.findUnique.mockResolvedValue({
        ...makeSession({ expiresAt: PAST }),
        user: BASE_USER,
      } as never);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('revoked session', () => {
    it('throws UnauthorizedException when session.revokedAt is set', async () => {
      const { guard, jwtService, prisma } = makeGuard();
      const ctx = makeContext({
        cookies: { auth_token: 'good-token' },
        headers: {},
      });
      jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
      prisma.session.findUnique.mockResolvedValue({
        ...makeSession({ revokedAt: PAST }),
        user: BASE_USER,
      } as never);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('valid token', () => {
    it('returns true and attaches user + jti to request', async () => {
      const { guard, jwtService, prisma } = makeGuard();
      const req: Partial<AuthenticatedRequest> = {
        cookies: { auth_token: 'good-token' },
        headers: {},
      };
      const ctx = makeContext(req);
      jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
      prisma.session.findUnique.mockResolvedValue({
        ...makeSession(),
        user: BASE_USER,
      } as never);

      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect((req as AuthenticatedRequest).user).toMatchObject({
        id: 'user-1',
        email: 'alice@example.com',
        displayName: 'Alice',
      });
      expect((req as AuthenticatedRequest).sessionJti).toBe('jti-abc');
    });

    it('extracts token from Authorization: Bearer header when no cookie', async () => {
      const { guard, jwtService, prisma } = makeGuard();
      const req: Partial<AuthenticatedRequest> = {
        cookies: {},
        headers: { authorization: 'Bearer bearer-token' },
      };
      const ctx = makeContext(req);
      jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
      prisma.session.findUnique.mockResolvedValue({
        ...makeSession(),
        user: BASE_USER,
      } as never);

      await guard.canActivate(ctx);

      expect(jwtService.verify).toHaveBeenCalledWith('bearer-token');
    });

    it('prefers cookie over Authorization header', async () => {
      const { guard, jwtService, prisma } = makeGuard();
      const req: Partial<AuthenticatedRequest> = {
        cookies: { auth_token: 'cookie-token' },
        headers: { authorization: 'Bearer header-token' },
      };
      const ctx = makeContext(req);
      jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
      prisma.session.findUnique.mockResolvedValue({
        ...makeSession(),
        user: BASE_USER,
      } as never);

      await guard.canActivate(ctx);

      expect(jwtService.verify).toHaveBeenCalledWith('cookie-token');
    });
  });
});
