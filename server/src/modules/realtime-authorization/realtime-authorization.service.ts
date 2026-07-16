import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import type { Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { AuthUser } from '../auth/types/auth-user.type';

export const SOCKET_SESSION_JTI = 'sessionJti';

const INVALIDATION_CHANNEL = 'realtime:authorization:invalidate';
const SESSION_CACHE_TTL_MS = 1_000;
const MAX_SESSION_CACHE_ENTRIES = 10_000;

export type RealtimeAuthorizationInvalidation =
  | { type: 'session'; jti: string }
  | { type: 'user'; userId: string }
  | { type: 'workspace'; workspaceId: string; userId: string };

interface InvalidationEnvelope {
  originId: string;
  invalidation: RealtimeAuthorizationInvalidation;
}

type InvalidationListener = (
  invalidation: RealtimeAuthorizationInvalidation,
) => void | Promise<void>;

/**
 * Revalidates the database-backed session behind an already-connected socket
 * and fans revocations out locally and across instances.
 *
 * A verified JWT is not enough for a long-lived WebSocket: logout and password
 * reset revoke the Session row while the JWT itself remains cryptographically
 * valid. Gateways call isSessionActive for protected events and also subscribe
 * to invalidations so passive sockets stop receiving broadcasts immediately.
 */
@Injectable()
export class RealtimeAuthorizationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly listeners = new Set<InvalidationListener>();
  // Per-instance so sibling replicas booted in the same process still treat
  // each other's invalidation messages as remote.
  private readonly originId = randomUUID();
  private readonly sessionCache = new Map<
    string,
    { active: boolean; validUntil: number; userId: string }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectPinoLogger(RealtimeAuthorizationService.name)
    private readonly logger: PinoLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redis.subscribe(INVALIDATION_CHANNEL, (_channel, raw) => {
      this.handleRemoteInvalidation(String(raw));
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.listeners.clear();
    this.sessionCache.clear();
    try {
      await this.redis.unsubscribe(INVALIDATION_CHANNEL);
    } catch (err) {
      this.logger.warn({ err }, 'Failed to unsubscribe realtime authorization channel');
    }
  }

  /** Returns true only while the exact Session row behind this socket is active. */
  async isSessionActive(socket: Socket, force = false): Promise<boolean> {
    const user = socket.data['user'] as AuthUser | undefined;
    const jti = socket.data[SOCKET_SESSION_JTI] as string | undefined;
    if (user === undefined || typeof jti !== 'string' || jti.length === 0) {
      return false;
    }

    const now = Date.now();
    const cached = this.sessionCache.get(jti);
    if (
      !force &&
      cached !== undefined &&
      cached.userId === user.id &&
      now < cached.validUntil
    ) {
      return cached.active;
    }

    const session = await this.prisma.session.findUnique({
      where: { jti },
      select: { userId: true, expiresAt: true, revokedAt: true },
    });

    const active = (
      session !== null &&
      session.userId === user.id &&
      session.revokedAt === null &&
      session.expiresAt > new Date()
    );
    const validUntil = active
      ? Math.min(now + SESSION_CACHE_TTL_MS, session.expiresAt.getTime())
      : now + SESSION_CACHE_TTL_MS;
    this.storeSessionCache(jti, { active, validUntil, userId: user.id }, now);
    return active;
  }

  onInvalidation(listener: InvalidationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async invalidateSession(jti: string): Promise<void> {
    await this.publish({ type: 'session', jti });
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.publish({ type: 'user', userId });
  }

  async invalidateWorkspaceAccess(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await this.publish({ type: 'workspace', workspaceId, userId });
  }

  private async publish(
    invalidation: RealtimeAuthorizationInvalidation,
  ): Promise<void> {
    // Local delivery does not depend on Redis, so revocation remains immediate
    // in a single-instance deployment or during a Redis outage.
    this.evict(invalidation);
    this.notify(invalidation);

    const envelope: InvalidationEnvelope = { originId: this.originId, invalidation };
    await this.redis.publish(INVALIDATION_CHANNEL, JSON.stringify(envelope));
  }

  private handleRemoteInvalidation(raw: string): void {
    let envelope: InvalidationEnvelope;
    try {
      envelope = JSON.parse(raw) as InvalidationEnvelope;
    } catch {
      this.logger.warn('Ignored malformed realtime authorization invalidation');
      return;
    }

    if (envelope.originId === this.originId) return;
    if (!isInvalidation(envelope.invalidation)) {
      this.logger.warn('Ignored invalid realtime authorization invalidation');
      return;
    }
    this.evict(envelope.invalidation);
    this.notify(envelope.invalidation);
  }

  private evict(invalidation: RealtimeAuthorizationInvalidation): void {
    if (invalidation.type === 'session') {
      this.sessionCache.delete(invalidation.jti);
      return;
    }
    if (invalidation.type === 'user') {
      for (const [jti, entry] of this.sessionCache) {
        if (entry.userId === invalidation.userId) this.sessionCache.delete(jti);
      }
    }
  }

  private storeSessionCache(
    jti: string,
    entry: { active: boolean; validUntil: number; userId: string },
    now: number,
  ): void {
    if (this.sessionCache.size >= MAX_SESSION_CACHE_ENTRIES) {
      for (const [cachedJti, cached] of this.sessionCache) {
        if (cached.validUntil <= now) this.sessionCache.delete(cachedJti);
      }
      if (this.sessionCache.size >= MAX_SESSION_CACHE_ENTRIES) {
        const oldest = this.sessionCache.keys().next().value as string | undefined;
        if (oldest !== undefined) this.sessionCache.delete(oldest);
      }
    }
    this.sessionCache.set(jti, entry);
  }

  private notify(invalidation: RealtimeAuthorizationInvalidation): void {
    for (const listener of this.listeners) {
      try {
        void Promise.resolve(listener(invalidation)).catch((err: unknown) => {
          this.logger.error(
            { err, invalidation },
            'Realtime authorization invalidation listener failed',
          );
        });
      } catch (err) {
        this.logger.error(
          { err, invalidation },
          'Realtime authorization invalidation listener failed',
        );
      }
    }
  }
}

function isInvalidation(value: unknown): value is RealtimeAuthorizationInvalidation {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  switch (candidate['type']) {
    case 'session':
      return typeof candidate['jti'] === 'string' && candidate['jti'].length > 0;
    case 'user':
      return typeof candidate['userId'] === 'string' && candidate['userId'].length > 0;
    case 'workspace':
      return (
        typeof candidate['workspaceId'] === 'string' &&
        candidate['workspaceId'].length > 0 &&
        typeof candidate['userId'] === 'string' &&
        candidate['userId'].length > 0
      );
    default:
      return false;
  }
}
