import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  dependencies: {
    postgres: 'ok' | 'error';
    redis: 'ok' | 'error' | 'disabled';
  };
  timestamp: string;
}

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  getHealth(): {
    status: string;
    service: string;
    timestamp: string;
    uptime: number;
  } {
    return {
      status: 'ok',
      service: 'meridian-server',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const [postgres, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    const status = postgres === 'ok' ? 'ready' : 'not_ready';
    return {
      status,
      dependencies: { postgres, redis },
      timestamp: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------

  private async checkPostgres(): Promise<'ok' | 'error'> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 2_000);
      return 'ok';
    } catch {
      return 'error';
    }
  }

  private async checkRedis(): Promise<'ok' | 'error' | 'disabled'> {
    if (!this.redis.isAvailable) return 'disabled';
    try {
      const ok = await withTimeout(this.redis.ping(), 2_000);
      return ok ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms`)),
      ms,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
