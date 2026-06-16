import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';

interface CleanupDto {
  emailPrefix?: string;
}

/**
 * Test-only endpoints used by the Playwright E2E suite to keep the database
 * from accumulating throwaway accounts across runs.
 *
 * Every handler returns 404 unless E2E_TEST=true, so these routes are
 * completely inert in development and production.
 */
@ApiExcludeController()
@SkipThrottle({ auth: true })
@Controller('e2e')
export class E2eController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(E2eController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanup(@Body() dto: CleanupDto): Promise<{ deletedUsers: number }> {
    if (process.env['E2E_TEST'] !== 'true') {
      throw new NotFoundException();
    }

    const prefix = dto.emailPrefix ?? 'e2e-';
    const users = await this.prisma.user.findMany({
      where: { email: { startsWith: prefix } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) {
      return { deletedUsers: 0 };
    }

    // Workspaces own their documents/members/invites via cascade, but the
    // workspace→owner relation is not cascade-deleted, so remove owned
    // workspaces first, then the users (which cascades the rest).
    await this.prisma.workspace.deleteMany({
      where: { ownerId: { in: userIds } },
    });
    const result = await this.prisma.user.deleteMany({
      where: { id: { in: userIds } },
    });

    this.logger.info({ deletedUsers: result.count }, 'E2E cleanup complete');
    return { deletedUsers: result.count };
  }
}
