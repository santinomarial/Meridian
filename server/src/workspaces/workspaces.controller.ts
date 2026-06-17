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
  Post,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Workspace } from '@prisma/client';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../modules/auth/types/auth-user.type';

@SkipThrottle({ auth: true })
@ApiTags('workspaces')
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's workspaces" })
  @ApiOkResponse({ description: 'Array of workspaces the user is a member of' })
  listWorkspaces(@CurrentUser() user: AuthUser) {
    return this.workspacesService.listForUser(user.id);
  }

  @Get(':workspaceId')
  @ApiOperation({ summary: 'Get a workspace by id' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'The workspace' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async getWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    return this.requireMemberWorkspace(user, workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a workspace owned by the current user' })
  @ApiCreatedResponse({ description: 'The created workspace' })
  createWorkspace(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    // The owner is always the authenticated user — a client-supplied ownerId
    // is ignored so users cannot create workspaces on behalf of others.
    return this.workspacesService.createWorkspace({
      name: dto.name,
      ownerId: user.id,
    });
  }

  @Patch(':workspaceId')
  @ApiOperation({ summary: 'Update a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'The updated workspace' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async updateWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    await this.requireOwnerAccess(user, workspaceId);
    return this.workspacesService.updateWorkspace(workspaceId, dto);
  }

  @Delete(':workspaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a workspace and all its documents (owner only)' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiNoContentResponse({ description: 'Workspace deleted' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async deleteWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    const ws = await this.requireMemberWorkspace(user, workspaceId);
    if (ws.ownerId !== user.id) {
      throw new ForbiddenException('Only the workspace owner can delete it');
    }
    await this.workspacesService.deleteWorkspace(workspaceId);
  }

  // ── Members ──────────────────────────────────────────────────────────────

  @Get(':workspaceId/members')
  @ApiOperation({ summary: 'List workspace members' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'Array of workspace members' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async listMembers(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    await this.requireMemberWorkspace(user, workspaceId);
    return this.workspacesService.listMembers(workspaceId);
  }

  @Post(':workspaceId/members')
  @ApiOperation({ summary: 'Add a member to a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiCreatedResponse({ description: 'The created membership' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async addMember(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AddMemberDto,
  ) {
    await this.requireOwnerAccess(user, workspaceId);
    return this.workspacesService.addMember(workspaceId, dto.userId, dto.role);
  }

  @Patch(':workspaceId/members/:memberId')
  @ApiOperation({ summary: 'Update a member role' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiParam({ name: 'memberId', description: 'WorkspaceMember cuid' })
  @ApiOkResponse({ description: 'The updated membership' })
  @ApiNotFoundResponse({ description: 'Member not found in this workspace' })
  async updateMember(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    await this.requireOwnerAccess(user, workspaceId);
    const member = await this.workspacesService.findMember(memberId);
    if (member === null || member.workspaceId !== workspaceId)
      throw new NotFoundException(`Member ${memberId} not found`);
    return this.workspacesService.updateMemberRole(memberId, dto.role);
  }

  @Delete(':workspaceId/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiParam({ name: 'memberId', description: 'WorkspaceMember cuid' })
  @ApiNoContentResponse({ description: 'Member removed' })
  @ApiNotFoundResponse({ description: 'Member not found in this workspace' })
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
  ) {
    await this.requireOwnerAccess(user, workspaceId);
    const member = await this.workspacesService.findMember(memberId);
    if (member === null || member.workspaceId !== workspaceId)
      throw new NotFoundException(`Member ${memberId} not found`);
    await this.workspacesService.removeMember(memberId);
  }

  /**
   * Loads a workspace and verifies the current user is a member.
   * Non-members receive 404 (not 403) so workspace ids are not enumerable.
   */
  private async requireMemberWorkspace(
    user: AuthUser,
    workspaceId: string,
  ): Promise<Workspace> {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    const isMember = await this.workspacesService.canUserAccessWorkspace(
      user.id,
      workspaceId,
    );
    if (!isMember)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    return ws;
  }

  /**
   * Loads a workspace and verifies the current user is an OWNER.
   * Non-members receive 404; members without owner role receive 403.
   */
  private async requireOwnerAccess(
    user: AuthUser,
    workspaceId: string,
  ): Promise<Workspace> {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    const role = await this.workspacesService.getMemberRole(user.id, workspaceId);
    if (role === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    if (role !== WorkspaceRole.OWNER)
      throw new ForbiddenException('Only workspace owners can perform this action');
    return ws;
  }
}
