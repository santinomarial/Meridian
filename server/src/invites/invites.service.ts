import { randomBytes } from 'node:crypto';
import {
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Invite, WorkspaceMember } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const INVITE_TTL_DAYS = 7;

export interface CreateInviteData {
  workspaceId: string;
  invitedById: string;
  role: WorkspaceRole;
  email?: string;
}

export type InviteWithContext = Invite & {
  workspace: { id: string; name: string };
  invitedBy: { id: string; displayName: string };
};

export interface AcceptInviteResult {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  membership: WorkspaceMember;
  alreadyMember: boolean;
}

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvite(data: CreateInviteData): Promise<Invite> {
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
    return this.prisma.invite.create({
      data: {
        token: randomBytes(24).toString('base64url'),
        workspaceId: data.workspaceId,
        invitedById: data.invitedById,
        role: data.role,
        email: data.email,
        expiresAt,
      },
    });
  }

  async findByToken(token: string): Promise<InviteWithContext | null> {
    return this.prisma.invite.findUnique({
      where: { token },
      include: {
        workspace: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, displayName: true } },
      },
    });
  }

  /**
   * Accepts an invite for the given user: validates the token, then adds the
   * user as a workspace member with the invite's role. Accepting twice (or
   * accepting an invite to a workspace the user already belongs to) is a
   * no-op that still succeeds, so shared invite links work for whole teams.
   */
  async acceptInvite(token: string, userId: string): Promise<AcceptInviteResult> {
    const invite = await this.findByToken(token);
    if (invite === null) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.expiresAt < new Date()) {
      throw new GoneException('This invite has expired');
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: invite.workspaceId, userId },
      },
    });

    const membership =
      existing ??
      (await this.prisma.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId,
          role: invite.role,
        },
      }));

    if (invite.acceptedAt === null) {
      await this.prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    }

    return {
      workspaceId: invite.workspaceId,
      workspaceName: invite.workspace.name,
      role: membership.role,
      membership,
      alreadyMember: existing !== null,
    };
  }

  async listForWorkspace(workspaceId: string): Promise<Invite[]> {
    return this.prisma.invite.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
