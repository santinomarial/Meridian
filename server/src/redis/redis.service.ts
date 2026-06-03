import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { AppConfig } from '../config/configuration.type';
import { APP_CONFIG_KEY } from '../config/app.config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  // Pattern → handler map.  Populated by subscribe(); routed in the pmessage
  // listener set up in the constructor.
  private readonly patternHandlers = new Map<
    string,
    (channel: string, message: string | Buffer) => void
  >();

  private _available = false;

  constructor(
    configService: ConfigService,
    @InjectPinoLogger(RedisService.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);

    // lazyConnect: true — connections are not opened until connect() is called
    // explicitly in onModuleInit, so errors are captured there rather than
    // crashing the process at construction time.
    //
    // retryStrategy: () => null — no automatic reconnection after a failure.
    // If Redis is unavailable at startup the service logs a warning and the
    // rest of the app continues in single-instance mode.
    //
    // enableOfflineQueue: false — commands issued while disconnected fail
    // immediately instead of being queued indefinitely.
    const opts: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    };

    this.publisher = new Redis(config.redisUrl, opts);
    this.subscriber = new Redis(config.redisUrl, opts);

    this.wireLifecycleEvents(this.publisher, 'publisher');
    this.wireLifecycleEvents(this.subscriber, 'subscriber');

    // Route pattern-subscribed messages to the registered handler.
    // The pmessage event fires for channels matching a psubscribe pattern.
    this.subscriber.on(
      'pmessage',
      (pattern: string, channel: string, message: string) => {
        this.patternHandlers.get(pattern)?.(channel, message);
      },
    );
  }

  get isAvailable(): boolean {
    return this._available;
  }

  async onModuleInit(): Promise<void> {
    // Wrap each connect() in a 3-second timeout so a slow or unreachable
    // Redis does not block the module initialization indefinitely.
    const timedConnect = (client: Redis): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Redis connection timed out after 3 s')),
          3_000,
        );
        client.connect().then(
          () => { clearTimeout(timer); resolve(); },
          (err: unknown) => { clearTimeout(timer); reject(err); },
        );
      });

    try {
      await Promise.all([timedConnect(this.publisher), timedConnect(this.subscriber)]);
      this._available = true;
      this.logger.info('Redis connected — cross-instance mode enabled');
    } catch (err) {
      this._available = false;
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Redis unavailable — continuing in single-instance mode',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // allSettled so one client failing does not prevent the other from closing.
    await Promise.allSettled([
      this.publisher.quit().catch(() => {}),
      this.subscriber.quit().catch(() => {}),
    ]);
  }

  /**
   * Publishes a message to a Redis channel.
   * No-ops silently when Redis is unavailable.
   */
  async publish(channel: string, payload: string | Buffer): Promise<void> {
    if (!this._available) return;
    try {
      await this.publisher.publish(channel, payload as string);
    } catch (err) {
      this.logger.warn({ err, channel }, 'Redis publish failed');
    }
  }

  /**
   * Subscribes to a channel pattern (PSUBSCRIBE) and registers a handler.
   * The handler receives the exact matching channel name and the raw message.
   * No-ops silently when Redis is unavailable.
   */
  async subscribe(
    pattern: string,
    handler: (channel: string, message: string | Buffer) => void,
  ): Promise<void> {
    if (!this._available) return;
    this.patternHandlers.set(pattern, handler);
    await this.subscriber.psubscribe(pattern);
  }

  /**
   * Removes a PSUBSCRIBE subscription and its handler.
   * No-ops silently when Redis is unavailable.
   */
  async unsubscribe(pattern: string): Promise<void> {
    if (!this._available) return;
    this.patternHandlers.delete(pattern);
    await this.subscriber.punsubscribe(pattern);
  }

  // ---------------------------------------------------------------------------

  private wireLifecycleEvents(client: Redis, name: string): void {
    client.on('connect', () =>
      this.logger.info({ client: name }, 'Redis client connecting'),
    );
    client.on('ready', () =>
      this.logger.info({ client: name }, 'Redis client ready'),
    );
    client.on('error', (err: Error) =>
      // Log as error after the service is available (unexpected disconnection),
      // as warn during startup (Redis simply not running).
      this._available
        ? this.logger.error({ client: name, err }, 'Redis client error')
        : this.logger.warn({ client: name, err: err.message }, 'Redis client error'),
    );
    client.on('close', () =>
      this.logger.info({ client: name }, 'Redis client connection closed'),
    );
  }
}
