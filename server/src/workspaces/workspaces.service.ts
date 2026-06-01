import { Injectable } from '@nestjs/common';
import type { Workspace, WorkspaceMember } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateWorkspaceData {
  name: string;
  ownerId: string;
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkspace(data: CreateWorkspaceData): Promise<Workspace> {
    return this.prisma.workspace.create({ data });
  }

  async findById(workspaceId: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({ where: { id: workspaceId } });
  }

  async listForUser(userId: string): Promise<Workspace[]> {
    return this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    });
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
