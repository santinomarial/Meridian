import { mockDeep } from 'jest-mock-extended';
import type { ConfigService } from '@nestjs/config';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { APP_CONFIG_KEY } from './config/app.config';

function makeConfig(redisRequired = false): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (key === APP_CONFIG_KEY) return { redisRequired };
      throw new Error(`unexpected config key: ${key}`);
    },
  } as unknown as ConfigService;
}

function makeService(redisRequired = false) {
  const prisma = mockDeep<PrismaService>();
  const redis = mockDeep<RedisService>();
  const service = new AppService(prisma, redis, makeConfig(redisRequired));
  return { service, prisma, redis };
}

describe('AppService', () => {
  describe('getHealth', () => {
    it('returns status ok with a timestamp', () => {
      const { service } = makeService();
      const result = service.getHealth();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('meridian-server');
      expect(typeof result.timestamp).toBe('string');
      expect(typeof result.uptime).toBe('number');
    });
  });

  describe('getReadiness', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns ready when postgres is reachable and redis is available + responsive', async () => {
      const { service, prisma, redis } = makeService();

      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }] as never);
      Object.defineProperty(redis, 'isAvailable', { get: () => true, configurable: true });
      redis.ping.mockResolvedValue(true);

      const result = await service.getReadiness();

      expect(result.status).toBe('ready');
      expect(result.dependencies.postgres).toBe('ok');
      expect(result.dependencies.redis).toBe('ok');
      expect(typeof result.timestamp).toBe('string');
    });

    it('returns not_ready when postgres query fails', async () => {
      const { service, prisma, redis } = makeService();

      prisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));
      Object.defineProperty(redis, 'isAvailable', { get: () => true, configurable: true });
      redis.ping.mockResolvedValue(true);

      const result = await service.getReadiness();

      expect(result.status).toBe('not_ready');
      expect(result.dependencies.postgres).toBe('error');
    });

    it('returns ready with redis disabled when redis is not available', async () => {
      const { service, prisma, redis } = makeService();

      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }] as never);
      Object.defineProperty(redis, 'isAvailable', { get: () => false, configurable: true });

      const result = await service.getReadiness();

      expect(result.status).toBe('ready');
      expect(result.dependencies.postgres).toBe('ok');
      expect(result.dependencies.redis).toBe('disabled');
    });

    it('returns ready with redis error when ping fails', async () => {
      const { service, prisma, redis } = makeService();

      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }] as never);
      Object.defineProperty(redis, 'isAvailable', { get: () => true, configurable: true });
      redis.ping.mockResolvedValue(false);

      const result = await service.getReadiness();

      expect(result.status).toBe('ready');
      expect(result.dependencies.redis).toBe('error');
    });

    it('returns ready with redis error when ping throws', async () => {
      const { service, prisma, redis } = makeService();

      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }] as never);
      Object.defineProperty(redis, 'isAvailable', { get: () => true, configurable: true });
      redis.ping.mockRejectedValue(new Error('connection lost'));

      const result = await service.getReadiness();

      expect(result.status).toBe('ready');
      expect(result.dependencies.redis).toBe('error');
    });

    it('returns not_ready when REDIS_REQUIRED and redis is disabled', async () => {
      const { service, prisma, redis } = makeService(true);

      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }] as never);
      Object.defineProperty(redis, 'isAvailable', { get: () => false, configurable: true });

      const result = await service.getReadiness();

      expect(result.status).toBe('not_ready');
      expect(result.dependencies.redis).toBe('disabled');
    });

    it('returns not_ready when REDIS_REQUIRED and redis ping fails', async () => {
      const { service, prisma, redis } = makeService(true);

      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }] as never);
      Object.defineProperty(redis, 'isAvailable', { get: () => true, configurable: true });
      redis.ping.mockResolvedValue(false);

      const result = await service.getReadiness();

      expect(result.status).toBe('not_ready');
      expect(result.dependencies.redis).toBe('error');
    });

    it('clears dependency timeout guards after checks settle', async () => {
      jest.useFakeTimers();
      const { service, prisma, redis } = makeService();

      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }] as never);
      Object.defineProperty(redis, 'isAvailable', { get: () => true, configurable: true });
      redis.ping.mockResolvedValue(true);

      await service.getReadiness();

      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
