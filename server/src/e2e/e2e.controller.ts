import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { CleanupE2eUsersDto } from './e2e.dto';
import {
  assertTestEmailPrefix,
  E2eOnlyGuard,
} from './e2e-safety';

/**
 * Test-only endpoints used by the Playwright E2E suite to keep the database
 * from accumulating throwaway accounts across runs.
 *
 * Every handler returns 404 unless E2E_TEST=true in a non-production process.
 */
@ApiExcludeController()
@SkipThrottle({ auth: true })
@UseGuards(E2eOnlyGuard)
@Controller('e2e')
export class E2eController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(E2eController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanup(
    @Body() dto: CleanupE2eUsersDto,
  ): Promise<{ deletedUsers: number }> {
    const prefix = assertTestEmailPrefix(dto.emailPrefix);

    const deletedUsers = await this.prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({
        where: {
          email: { startsWith: prefix, endsWith: '@example.com' },
        },
        select: { id: true },
      });
      const userIds = users.map((user) => user.id);
      if (userIds.length === 0) return 0;

      // Workspaces own their documents/members/invites via cascade, but the
      // workspace→owner relation is not cascade-deleted, so remove owned
      // workspaces first, then the users (which cascades the rest). Running
      // both operations in one transaction avoids leaving half-cleaned data.
      await tx.workspace.deleteMany({
        where: { ownerId: { in: userIds } },
      });
      const result = await tx.user.deleteMany({
        where: { id: { in: userIds } },
      });
      return result.count;
    });

    this.logger.info({ deletedUsers }, 'E2E cleanup complete');
    return { deletedUsers };
  }
}
