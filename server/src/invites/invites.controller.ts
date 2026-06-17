import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Invite } from '@prisma/client';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { MailService } from '../modules/mail/mail.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../modules/auth/types/auth-user.type';
import type { AppConfig } from '../config/configuration.type';
import { APP_CONFIG_KEY } from '../config/app.config';

interface InviteResponse {
  id: string;
  token: string;
  workspaceId: string;
  role: string;
  email: string | null;
  expiresAt: Date;
  inviteUrl: string;
}

@SkipThrottle({ auth: true })
@ApiTags('invites')
@Controller()
export class InvitesController {
  private readonly clientOrigin: string;

  constructor(
    private readonly invitesService: InvitesService,
    private readonly workspacesService: WorkspacesService,
    private readonly mailService: MailService,
    configService: ConfigService,
    @InjectPinoLogger(InvitesController.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.clientOrigin = config.clientOrigin;
  }

  @Post('workspaces/:workspaceId/invites')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Create an invite link for a workspace, optionally emailing it',
  })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiCreatedResponse({ description: 'The created invite with its shareable URL' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async createInvite(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateInviteDto,
  ): Promise<InviteResponse> {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null) throw new NotFoundException(`Workspace ${workspaceId} not found`);
    const role = await this.workspacesService.getMemberRole(user.id, workspaceId);
    if (role === null) throw new NotFoundException(`Workspace ${workspaceId} not found`);
    if (role !== WorkspaceRole.OWNER)
      throw new ForbiddenException('Only workspace owners can create invites');

    const invite = await this.invitesService.createInvite({
      workspaceId,
      invitedById: user.id,
      role: dto.role,
      email: dto.email,
    });
    const inviteUrl = this.buildInviteUrl(invite);

    if (dto.email !== undefined) {
      // Email delivery is best-effort — the invite link still works if the
      // mail provider is down, so the inviter can share it manually.
      try {
        await this.mailService.sendWorkspaceInviteEmail(
          dto.email,
          user.displayName,
          ws.name,
          inviteUrl,
        );
      } catch (err) {
        this.logger.error(
          { err, inviteId: invite.id },
          'Failed to send invite email',
        );
      }
    }

    return this.toResponse(invite);
  }

  @Get('workspaces/:workspaceId/invites')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List invites for a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'Array of invites' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async listInvites(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<InviteResponse[]> {
    const isMember = await this.workspacesService.canUserAccessWorkspace(
      user.id,
      workspaceId,
    );
    if (!isMember) {
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    }
    const invites = await this.invitesService.listForWorkspace(workspaceId);
    return invites.map((invite) => this.toResponse(invite));
  }

  @Get('invites/:token')
  @ApiOperation({
    summary: 'Get public details of an invite (no authentication required)',
  })
  @ApiParam({ name: 'token', description: 'Invite token from the invite link' })
  @ApiOkResponse({ description: 'Workspace name, role, and inviter for the invite' })
  @ApiNotFoundResponse({ description: 'Invite not found' })
  async getInvite(@Param('token') token: string) {
    const invite = await this.invitesService.findByToken(token);
    if (invite === null) {
      throw new NotFoundException('Invite not found');
    }
    return {
      token: invite.token,
      workspaceName: invite.workspace.name,
      role: invite.role,
      invitedByName: invite.invitedBy.displayName,
      expiresAt: invite.expiresAt,
      expired: invite.expiresAt < new Date(),
    };
  }

  @Post('invites/:token/accept')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invite as the current user' })
  @ApiParam({ name: 'token', description: 'Invite token from the invite link' })
  @ApiOkResponse({ description: 'The resulting workspace membership' })
  @ApiNotFoundResponse({ description: 'Invite not found' })
  async acceptInvite(
    @CurrentUser() user: AuthUser,
    @Param('token') token: string,
  ) {
    const result = await this.invitesService.acceptInvite(token, user.id);
    this.logger.info(
      { userId: user.id, workspaceId: result.workspaceId },
      'Invite accepted',
    );
    return {
      workspaceId: result.workspaceId,
      workspaceName: result.workspaceName,
      role: result.role,
      alreadyMember: result.alreadyMember,
    };
  }

  private buildInviteUrl(invite: Invite): string {
    return `${this.clientOrigin}/invite/${invite.token}`;
  }

  private toResponse(invite: Invite): InviteResponse {
    return {
      id: invite.id,
      token: invite.token,
      workspaceId: invite.workspaceId,
      role: invite.role,
      email: invite.email,
      expiresAt: invite.expiresAt,
      inviteUrl: this.buildInviteUrl(invite),
    };
  }
}
