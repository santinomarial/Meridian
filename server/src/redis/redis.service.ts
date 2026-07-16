import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { AppConfig } from '../config/configuration.type';
import { APP_CONFIG_KEY } from '../config/app.config';

export type RedisMessageHandler = (
  channel: string,
  message: string | Buffer,
) => void;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  /** Logical pattern → handler. Patterns are stored without the env prefix. */
  private readonly patternHandlers = new Map<string, RedisMessageHandler>();

  private readonly keyPrefix: string;
  private readonly redisRequired: boolean;
  private _available = false;
  private shuttingDown = false;

  constructor(
    configService: ConfigService,
    @InjectPinoLogger(RedisService.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.keyPrefix = config.redisKeyPrefix;
    this.redisRequired = config.redisRequired;

    // Reconnect with capped exponential backoff so multi-replica fleets can
    // recover from brief Redis blips. enableOfflineQueue stays false so
    // publishes during an outage fail closed instead of buffering forever.
    const opts: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => {
        if (this.shuttingDown) return null;
        return Math.min(times * 200, 5_000);
      },
    };

    this.publisher = new Redis(config.redisUrl, opts);
    this.subscriber = new Redis(config.redisUrl, opts);

    this.wireLifecycleEvents(this.publisher, 'publisher');
    this.wireLifecycleEvents(this.subscriber, 'subscriber');

    this.subscriber.on(
      'pmessage',
      (pattern: string, channel: string, message: string) => {
        const logicalPattern = this.stripPrefix(pattern);
        this.patternHandlers.get(logicalPattern)?.(
          this.stripPrefix(channel),
          message,
        );
      },
    );

    // After a reconnect, ioredis drops pattern subscriptions — re-apply them.
    this.subscriber.on('ready', () => {
      void this.resubscribeAll('subscriber ready');
    });
  }

  get isAvailable(): boolean {
    return this._available;
  }

  get isRequired(): boolean {
    return this.redisRequired;
  }

  /** Environment prefix applied to every Redis key and pub/sub channel. */
  get prefix(): string {
    return this.keyPrefix;
  }

  async onModuleInit(): Promise<void> {
    const timedConnect = (client: Redis): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Redis connection timed out after 3 s')),
          3_000,
        );
        client.connect().then(
          () => {
            clearTimeout(timer);
            resolve();
          },
          (err: unknown) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });

    try {
      await Promise.all([
        timedConnect(this.publisher),
        timedConnect(this.subscriber),
      ]);
      this._available = true;
      this.logger.info(
        { keyPrefix: this.keyPrefix || '(none)', redisRequired: this.redisRequired },
        'Redis connected — cross-instance mode enabled',
      );
    } catch (err) {
      this._available = false;
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        this.redisRequired
          ? 'Redis unavailable at startup — /ready will stay not_ready until reconnect'
          : 'Redis unavailable — continuing in single-instance mode',
      );
      // Keep retrying in the background when Redis is required (or whenever
      // ioredis reconnects after a later blip). Initial connect() failure still
      // leaves the clients in a reconnect loop via retryStrategy.
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    this.patternHandlers.clear();
    await Promise.allSettled([
      this.publisher.quit().catch(() => {
        this.publisher.disconnect();
      }),
      this.subscriber.quit().catch(() => {
        this.subscriber.disconnect();
      }),
    ]);
  }

  async ping(): Promise<boolean> {
    if (!this._available) return false;
    try {
      const result = await this.publisher.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async publish(channel: string, payload: string | Buffer): Promise<void> {
    if (!this._available) return;
    try {
      await this.publisher.publish(this.applyPrefix(channel), payload as string);
    } catch (err) {
      this.logger.warn({ err, channel }, 'Redis publish failed');
    }
  }

  /**
   * Subscribes to a channel pattern (PSUBSCRIBE) and registers a handler.
   * Handlers receive logical (unprefixed) channel names.
   */
  async subscribe(
    pattern: string,
    handler: RedisMessageHandler,
  ): Promise<void> {
    this.patternHandlers.set(pattern, handler);
    if (!this._available) return;
    try {
      await this.subscriber.psubscribe(this.applyPrefix(pattern));
    } catch (err) {
      this.logger.warn({ err, pattern }, 'Redis subscribe failed');
    }
  }

  async unsubscribe(pattern: string): Promise<void> {
    this.patternHandlers.delete(pattern);
    if (!this._available) return;
    try {
      await this.subscriber.punsubscribe(this.applyPrefix(pattern));
    } catch (err) {
      this.logger.warn({ err, pattern }, 'Redis unsubscribe failed');
    }
  }

  private static readonly ALLOCATE_SEQ_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('SET', KEYS[1], ARGV[1])
end
return redis.call('INCR', KEYS[1])`;

  async allocateSeq(key: string, floor: number): Promise<number | null> {
    if (!this._available) return null;
    try {
      const result = await this.publisher.eval(
        RedisService.ALLOCATE_SEQ_LUA,
        1,
        this.applyPrefix(key),
        String(floor),
      );
      return typeof result === 'number' ? result : Number(result);
    } catch (err) {
      this.logger.warn({ err, key }, 'Redis allocateSeq failed');
      return null;
    }
  }

  async incr(key: string): Promise<number | null> {
    if (!this._available) return null;
    try {
      return await this.publisher.incr(this.applyPrefix(key));
    } catch (err) {
      this.logger.warn({ err, key }, 'Redis incr failed');
      return null;
    }
  }

  async del(key: string): Promise<void> {
    if (!this._available) return;
    try {
      await this.publisher.del(this.applyPrefix(key));
    } catch (err) {
      this.logger.warn({ err, key }, 'Redis del failed');
    }
  }

  applyPrefix(name: string): string {
    if (!this.keyPrefix) return name;
    if (name.startsWith(this.keyPrefix)) return name;
    return `${this.keyPrefix}${name}`;
  }

  stripPrefix(name: string): string {
    if (!this.keyPrefix) return name;
    return name.startsWith(this.keyPrefix)
      ? name.slice(this.keyPrefix.length)
      : name;
  }

  private async resubscribeAll(reason: string): Promise<void> {
    if (this.shuttingDown || this.patternHandlers.size === 0) return;
    const patterns = [...this.patternHandlers.keys()].map((p) =>
      this.applyPrefix(p),
    );
    try {
      await this.subscriber.psubscribe(...patterns);
      this.logger.info(
        { reason, patterns: patterns.length },
        'Redis pattern subscriptions restored',
      );
    } catch (err) {
      this.logger.warn({ err, reason }, 'Redis resubscribe failed');
    }
  }

  private wireLifecycleEvents(client: Redis, name: string): void {
    client.on('connect', () =>
      this.logger.info({ client: name }, 'Redis client connecting'),
    );
    client.on('ready', () => {
      this._available = true;
      this.logger.info({ client: name }, 'Redis client ready');
    });
    client.on('error', (err: Error) =>
      this._available
        ? this.logger.error({ client: name, err }, 'Redis client error')
        : this.logger.warn(
            { client: name, err: err.message },
            'Redis client error',
          ),
    );
    client.on('close', () => {
      this._available = false;
      this.logger.info({ client: name }, 'Redis client connection closed');
    });
  }
}
