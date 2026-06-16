import { GoneException, NotFoundException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Invite, WorkspaceMember } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService, type InviteWithContext } from './invites.service';

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

function makeInvite(overrides: Partial<InviteWithContext> = {}): InviteWithContext {
  return {
    id: 'invite-1',
    token: 'tok-abc',
    workspaceId: 'ws-1',
    invitedById: 'user-owner',
    email: null,
    role: WorkspaceRole.EDITOR,
    expiresAt: FUTURE,
    acceptedAt: null,
    createdAt: new Date('2024-01-01'),
    workspace: { id: 'ws-1', name: 'Meridian' },
    invitedBy: { id: 'user-owner', displayName: 'Owner' },
    ...overrides,
  };
}

const BASE_MEMBER: WorkspaceMember = {
  id: 'member-1',
  workspaceId: 'ws-1',
  userId: 'user-2',
  role: WorkspaceRole.EDITOR,
  createdAt: new Date('2024-01-01'),
};

describe('InvitesService', () => {
  let service: InvitesService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new InvitesService(prisma);
  });

  describe('createInvite', () => {
    it('creates an invite with a token and a future expiry', async () => {
      const created = makeInvite() as unknown as Invite;
      prisma.invite.create.mockResolvedValue(created);

      const result = await service.createInvite({
        workspaceId: 'ws-1',
        invitedById: 'user-owner',
        role: WorkspaceRole.EDITOR,
      });

      expect(prisma.invite.create).toHaveBeenCalledTimes(1);
      const arg = prisma.invite.create.mock.calls[0]![0] as {
        data: { token: string; role: WorkspaceRole; expiresAt: Date };
      };
      expect(arg.data.token).toEqual(expect.any(String));
      expect(arg.data.token.length).toBeGreaterThan(16);
      expect(arg.data.role).toBe(WorkspaceRole.EDITOR);
      expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(result).toEqual(created);
    });
  });

  describe('acceptInvite', () => {
    it('throws NotFound for an unknown token', async () => {
      prisma.invite.findUnique.mockResolvedValue(null);

      await expect(service.acceptInvite('missing', 'user-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Gone for an expired invite', async () => {
      prisma.invite.findUnique.mockResolvedValue(
        makeInvite({ expiresAt: PAST }) as never,
      );

      await expect(service.acceptInvite('tok-abc', 'user-2')).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(prisma.workspaceMember.create).not.toHaveBeenCalled();
    });

    it('adds the user as a member with the invite role and marks accepted', async () => {
      prisma.invite.findUnique.mockResolvedValue(makeInvite() as never);
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      prisma.workspaceMember.create.mockResolvedValue(BASE_MEMBER);
      prisma.invite.update.mockResolvedValue(makeInvite() as never);

      const result = await service.acceptInvite('tok-abc', 'user-2');

      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 'user-2', role: WorkspaceRole.EDITOR },
      });
      expect(prisma.invite.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { acceptedAt: expect.any(Date) },
      });
      expect(result.alreadyMember).toBe(false);
      expect(result.role).toBe(WorkspaceRole.EDITOR);
      expect(result.workspaceId).toBe('ws-1');
    });

    it('is idempotent when the user is already a member', async () => {
      prisma.invite.findUnique.mockResolvedValue(
        makeInvite({ acceptedAt: PAST }) as never,
      );
      prisma.workspaceMember.findUnique.mockResolvedValue(BASE_MEMBER);

      const result = await service.acceptInvite('tok-abc', 'user-2');

      expect(prisma.workspaceMember.create).not.toHaveBeenCalled();
      expect(result.alreadyMember).toBe(true);
    });
  });
});
