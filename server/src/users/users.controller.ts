import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../modules/auth/types/auth-user.type';
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
} from '../modules/auth/auth-cookie';

/** Public projection of a user — never exposes passwordHash. */
function toPublicUser(user: User, opts: { includeEmail: boolean }) {
  return {
    id: user.id,
    ...(opts.includeEmail ? { email: user.email } : {}),
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@SkipThrottle({ auth: true })
@ApiTags('users')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':userId')
  @ApiOperation({
    summary:
      'Get a user by id (self: full profile; shared-workspace peer: no email)',
  })
  @ApiParam({ name: 'userId', description: 'User cuid' })
  @ApiOkResponse({ description: 'The user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async getUser(
    @CurrentUser() currentUser: AuthUser,
    @Param('userId') userId: string,
  ) {
    const allowed = await this.usersService.canViewProfile(
      currentUser.id,
      userId,
    );
    if (!allowed) {
      // Same status as a missing user so IDs are not cross-tenant enumerable.
      throw new NotFoundException(`User ${userId} not found`);
    }
    const user = await this.usersService.findById(userId);
    if (user === null) throw new NotFoundException(`User ${userId} not found`);
    return toPublicUser(user, { includeEmail: currentUser.id === userId });
  }

  @Patch(':userId')
  @ApiOperation({ summary: 'Update your own profile' })
  @ApiParam({ name: 'userId', description: 'User cuid' })
  @ApiOkResponse({ description: 'The updated user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async updateUser(
    @CurrentUser() currentUser: AuthUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    if (currentUser.id !== userId) {
      throw new ForbiddenException('You can only update your own profile');
    }
    const user = await this.usersService.findById(userId);
    if (user === null) throw new NotFoundException(`User ${userId} not found`);
    return toPublicUser(await this.usersService.updateUser(userId, dto), {
      includeEmail: true,
    });
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete your own account' })
  @ApiParam({ name: 'userId', description: 'User cuid' })
  @ApiNoContentResponse({ description: 'User deleted' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async deleteUser(
    @CurrentUser() currentUser: AuthUser,
    @Param('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (currentUser.id !== userId) {
      throw new ForbiddenException('You can only delete your own account');
    }
    const user = await this.usersService.findById(userId);
    if (user === null) throw new NotFoundException(`User ${userId} not found`);
    await this.usersService.deleteUser(userId);
    res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
  }
}
