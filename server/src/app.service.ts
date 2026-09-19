import { IsolatedTerminalService } from './modules/terminal/isolated-terminal.service';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import type { AppConfig } from './config/configuration.type';
import { APP_CONFIG_KEY } from './config/app.config';

export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  dependencies: {
    postgres: 'ok' | 'error';
    redis: 'ok' | 'error' | 'disabled';
    terminal?: 'ok' | 'error';
  };
  timestamp: string;
}

@Injectable()
export class AppService {
  private readonly redisRequired: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    configService: ConfigService,
    @Optional() private readonly runner?: IsolatedTerminalService,
  ) {
    this.redisRequired =
      configService.getOrThrow<AppConfig>(APP_CONFIG_KEY).redisRequired;
  }

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
    const [postgres, redis, terminal] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.runner?.enabled ? this.runner.health().then(() => 'ok' as const, () => 'error' as const) : Promise.resolve(undefined),
    ]);

    const redisBlocking =
      this.redisRequired && redis !== 'ok';
    const status =
      postgres === 'ok' && !redisBlocking && terminal !== 'error' ? 'ready' : 'not_ready';
    return {
      status,
      dependencies: { postgres, redis, ...(terminal ? { terminal } : {}) },
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
