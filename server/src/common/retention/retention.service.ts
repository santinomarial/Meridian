import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service';

const RETENTION_INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * Purges expired/revoked auth and invite rows. Live authentication already
 * rejects these records; this only bounds retention.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(RetentionService.name)
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.purgeExpired().catch((err: unknown) => {
        this.logger.error({ err }, 'Retention purge failed');
      });
    }, RETENTION_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  async purgeExpired(): Promise<{
    sessions: number;
    resetTokens: number;
    invites: number;
  }> {
    const now = new Date();
    const [sessions, resetTokens, invites] = await Promise.all([
      this.prisma.session.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }],
        },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }],
        },
      }),
      this.prisma.invite.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { acceptedAt: { not: null } }],
        },
      }),
    ]);

    const result = {
      sessions: sessions.count,
      resetTokens: resetTokens.count,
      invites: invites.count,
    };
    if (result.sessions + result.resetTokens + result.invites > 0) {
      this.logger.info(result, 'Purged expired auth and invite records');
    }
    return result;
  }
}
