import { createHash, randomBytes } from 'node:crypto';
import {
  ForbiddenException,
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

export interface CreatedInvite {
  invite: Invite;
  /** Raw bearer token — returned once; only the hash is stored. */
  token: string;
}

export interface AcceptInviteResult {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  membership: WorkspaceMember;
  alreadyMember: boolean;
}

function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  async createInvite(data: CreateInviteData): Promise<CreatedInvite> {
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
    const invite = await this.prisma.invite.create({
      data: {
        tokenHash: hashInviteToken(token),
        workspaceId: data.workspaceId,
        invitedById: data.invitedById,
        role: data.role,
        email: data.email?.trim().toLowerCase() || undefined,
        expiresAt,
      },
    });
    return { invite, token };
  }

  async findByToken(token: string): Promise<InviteWithContext | null> {
    return this.prisma.invite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: {
        workspace: { select: { id: true, name: true } },
        invitedBy: { select: { id: true, displayName: true } },
      },
    });
  }

  /**
   * Accepts an invite for the given user. Invites are single-use: once
   * `acceptedAt` is set the token cannot be redeemed again. When the invite
   * carries an email, only that account may accept.
   */
  async acceptInvite(
    token: string,
    userId: string,
    userEmail: string,
  ): Promise<AcceptInviteResult> {
    const invite = await this.findByToken(token);
    if (invite === null) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.expiresAt < new Date()) {
      throw new GoneException('This invite has expired');
    }
    if (invite.acceptedAt !== null) {
      throw new GoneException('This invite has already been used');
    }
    if (
      invite.email !== null &&
      invite.email.toLowerCase() !== userEmail.trim().toLowerCase()
    ) {
      throw new ForbiddenException(
        'This invite was sent to a different email address',
      );
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

    await this.prisma.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

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
