import { Injectable } from '@nestjs/common';
import type { Workspace, WorkspaceMember } from '@prisma/client';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateWorkspaceData {
  name: string;
  ownerId: string;
}

export interface UpdateWorkspaceData {
  name?: string;
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkspace(data: CreateWorkspaceData): Promise<Workspace> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const workspace = await tx.workspace.create({ data });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: data.ownerId, role: WorkspaceRole.OWNER },
      });
      return workspace;
    });
  }

  async findById(workspaceId: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({ where: { id: workspaceId } });
  }

  async listAll(): Promise<Workspace[]> {
    return this.prisma.workspace.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    return this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateWorkspace(
    workspaceId: string,
    data: UpdateWorkspaceData,
  ): Promise<Workspace> {
    return this.prisma.workspace.update({ where: { id: workspaceId }, data });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMember(memberId: string): Promise<WorkspaceMember | null> {
    return this.prisma.workspaceMember.findUnique({ where: { id: memberId } });
  }

  async addMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    return this.prisma.workspaceMember.create({
      data: { workspaceId, userId, role },
    });
  }

  async updateMemberRole(
    memberId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role },
    });
  }

  async removeMember(memberId: string): Promise<void> {
    await this.prisma.workspaceMember.delete({ where: { id: memberId } });
  }

  async canUserAccessWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });
    return member !== null;
  }

  async canUserAccessDocument(
    userId: string,
    documentId: string,
  ): Promise<boolean> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { workspaceId: true },
    });
    if (doc === null) return false;
    return this.canUserAccessWorkspace(userId, doc.workspaceId);
  }
}
