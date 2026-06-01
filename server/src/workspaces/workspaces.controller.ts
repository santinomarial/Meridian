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
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  listWorkspaces() {
    return this.workspacesService.listAll();
  }

  @Get(':workspaceId')
  async getWorkspace(@Param('workspaceId') workspaceId: string) {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    return ws;
  }

  @Post()
  createWorkspace(@Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.createWorkspace(dto);
  }

  @Patch(':workspaceId')
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
  async deleteWorkspace(@Param('workspaceId') workspaceId: string) {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    await this.workspacesService.deleteWorkspace(workspaceId);
  }

  // ── Members ──────────────────────────────────────────────────────────────

  @Get(':workspaceId/members')
  async listMembers(@Param('workspaceId') workspaceId: string) {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    return this.workspacesService.listMembers(workspaceId);
  }

  @Post(':workspaceId/members')
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
