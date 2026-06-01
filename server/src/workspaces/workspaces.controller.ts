import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: 'List all workspaces' })
  @ApiOkResponse({ description: 'Array of workspaces' })
  listWorkspaces() {
    return this.workspacesService.listAll();
  }

  @Get(':workspaceId')
  @ApiOperation({ summary: 'Get a workspace by id' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'The workspace' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async getWorkspace(@Param('workspaceId') workspaceId: string) {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    return ws;
  }

  @Post()
  @ApiOperation({ summary: 'Create a workspace' })
  @ApiCreatedResponse({ description: 'The created workspace' })
  createWorkspace(@Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.createWorkspace(dto);
  }

  @Patch(':workspaceId')
  @ApiOperation({ summary: 'Update a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'The updated workspace' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async updateWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    return this.workspacesService.updateWorkspace(workspaceId, dto);
  }

  @Delete(':workspaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a workspace and all its documents' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiNoContentResponse({ description: 'Workspace deleted' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async deleteWorkspace(@Param('workspaceId') workspaceId: string) {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    await this.workspacesService.deleteWorkspace(workspaceId);
  }

  // ── Members ──────────────────────────────────────────────────────────────

  @Get(':workspaceId/members')
  @ApiOperation({ summary: 'List workspace members' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'Array of workspace members' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async listMembers(@Param('workspaceId') workspaceId: string) {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    return this.workspacesService.listMembers(workspaceId);
  }

  @Post(':workspaceId/members')
  @ApiOperation({ summary: 'Add a member to a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiCreatedResponse({ description: 'The created membership' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async addMember(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AddMemberDto,
  ) {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    return this.workspacesService.addMember(workspaceId, dto.userId, dto.role);
  }

  @Patch(':workspaceId/members/:memberId')
  @ApiOperation({ summary: 'Update a member role' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiParam({ name: 'memberId', description: 'WorkspaceMember cuid' })
  @ApiOkResponse({ description: 'The updated membership' })
  @ApiNotFoundResponse({ description: 'Member not found in this workspace' })
  async updateMember(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberDto,
  ) {
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
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
  ) {
    const member = await this.workspacesService.findMember(memberId);
    if (member === null || member.workspaceId !== workspaceId)
      throw new NotFoundException(`Member ${memberId} not found`);
    await this.workspacesService.removeMember(memberId);
  }
}
