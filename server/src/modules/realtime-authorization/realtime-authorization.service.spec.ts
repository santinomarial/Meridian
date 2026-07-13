import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Socket } from 'socket.io';
import type { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  RealtimeAuthorizationService,
  SOCKET_SESSION_JTI,
  type RealtimeAuthorizationInvalidation,
} from './realtime-authorization.service';

const USER = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'Alice',
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

function socket(data: Record<string, unknown> = {}): Socket {
  return { data } as unknown as Socket;
}

describe('RealtimeAuthorizationService', () => {
  let prisma: DeepMockProxy<PrismaService>;
  let redis: DeepMockProxy<RedisService>;
  let logger: DeepMockProxy<PinoLogger>;
  let service: RealtimeAuthorizationService;
  let redisHandler: ((channel: string, value: string | Buffer) => void) | undefined;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    redis = mockDeep<RedisService>();
    logger = mockDeep<PinoLogger>();
    redis.subscribe.mockImplementation(async (_pattern, handler) => {
      redisHandler = handler;
    });
    service = new RealtimeAuthorizationService(prisma, redis, logger);
  });

  it('fails closed when the socket does not retain its authenticated session jti', async () => {
    await expect(service.isSessionActive(socket({ user: USER }))).resolves.toBe(false);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it('accepts only an unexpired, unrevoked session for the same user', async () => {
    prisma.session.findUnique.mockResolvedValue({
      userId: USER.id,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    } as never);

    await expect(
      service.isSessionActive(
        socket({ user: USER, [SOCKET_SESSION_JTI]: 'jti-1' }),
      ),
    ).resolves.toBe(true);
    expect(prisma.session.findUnique).toHaveBeenCalledWith({
      where: { jti: 'jti-1' },
      select: { userId: true, expiresAt: true, revokedAt: true },
    });
  });

  it.each([
    null,
    { userId: 'other-user', expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
    { userId: USER.id, expiresAt: new Date(Date.now() - 1), revokedAt: null },
    { userId: USER.id, expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
  ])('rejects missing, mismatched, expired, or revoked sessions', async (row) => {
    prisma.session.findUnique.mockResolvedValue(row as never);
    await expect(
      service.isSessionActive(
        socket({ user: USER, [SOCKET_SESSION_JTI]: 'jti-1' }),
      ),
    ).resolves.toBe(false);
  });

  it('delivers local invalidation without depending on Redis and publishes cross-instance', async () => {
    const listener = jest.fn<void, [RealtimeAuthorizationInvalidation]>();
    service.onInvalidation(listener);
    redis.publish.mockResolvedValue(undefined);

    await service.invalidateWorkspaceAccess('ws-1', 'user-1');

    expect(listener).toHaveBeenCalledWith({
      type: 'workspace',
      workspaceId: 'ws-1',
      userId: 'user-1',
    });
    expect(redis.publish).toHaveBeenCalledWith(
      'realtime:authorization:invalidate',
      expect.stringContaining('"workspaceId":"ws-1"') as string,
    );
  });

  it('accepts valid remote invalidations and rejects malformed payloads', async () => {
    const listener = jest.fn<void, [RealtimeAuthorizationInvalidation]>();
    service.onInvalidation(listener);
    await service.onModuleInit();

    redisHandler?.(
      'realtime:authorization:invalidate',
      JSON.stringify({
        originId: 'another-instance',
        invalidation: { type: 'session', jti: 'revoked-jti' },
      }),
    );
    redisHandler?.('realtime:authorization:invalidate', '{not-json');
    redisHandler?.(
      'realtime:authorization:invalidate',
      JSON.stringify({ originId: 'another-instance', invalidation: { type: 'user' } }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: 'session', jti: 'revoked-jti' });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
