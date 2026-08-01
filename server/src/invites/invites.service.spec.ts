import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Invite, Prisma, WorkspaceMember } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService, type InviteWithContext } from './invites.service';

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

function makeInvite(overrides: Partial<InviteWithContext> = {}): InviteWithContext {
  return {
    id: 'invite-1',
    tokenHash: createHash('sha256').update('tok-abc').digest('hex'),
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
  let transaction: DeepMockProxy<Prisma.TransactionClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    transaction = mockDeep<Prisma.TransactionClient>();
    (prisma.$transaction as unknown as jest.Mock).mockImplementation(
      async (callback: (tx: DeepMockProxy<Prisma.TransactionClient>) => Promise<unknown>) =>
        callback(transaction),
    );
    service = new InvitesService(prisma);
  });

  describe('createInvite', () => {
    it('stores a hash and returns the raw token once', async () => {
      const created = makeInvite() as unknown as Invite;
      prisma.invite.create.mockResolvedValue(created);

      const result = await service.createInvite({
        workspaceId: 'ws-1',
        invitedById: 'user-owner',
        role: WorkspaceRole.EDITOR,
      });

      expect(prisma.invite.create).toHaveBeenCalledTimes(1);
      const arg = prisma.invite.create.mock.calls[0]![0] as {
        data: { tokenHash: string; role: WorkspaceRole; expiresAt: Date };
      };
      expect(arg.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(arg.data.role).toBe(WorkspaceRole.EDITOR);
      expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.invite).toEqual(created);
      expect(result.token.length).toBeGreaterThan(16);
      expect(createHash('sha256').update(result.token).digest('hex')).toBe(
        arg.data.tokenHash,
      );
    });

    it('never permits an invite to grant canonical ownership', async () => {
      await expect(
        service.createInvite({
          workspaceId: 'ws-1',
          invitedById: 'user-owner',
          role: WorkspaceRole.OWNER,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.invite.create).not.toHaveBeenCalled();
    });
  });

  describe('acceptInvite', () => {
    it('throws NotFound for an unknown token', async () => {
      prisma.invite.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptInvite('missing', 'user-2', 'user2@example.com', FUTURE),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Gone for an expired invite', async () => {
      prisma.invite.findUnique.mockResolvedValue(
        makeInvite({ expiresAt: PAST }) as never,
      );

      await expect(
        service.acceptInvite('tok-abc', 'user-2', 'user2@example.com', FUTURE),
      ).rejects.toBeInstanceOf(GoneException);
      expect(prisma.workspaceMember.create).not.toHaveBeenCalled();
    });

    it('throws Gone for an already-used invite', async () => {
      prisma.invite.findUnique.mockResolvedValue(
        makeInvite({ acceptedAt: PAST }) as never,
      );

      await expect(
        service.acceptInvite('tok-abc', 'user-2', 'user2@example.com', FUTURE),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('rejects accept when invite email does not match the user', async () => {
      prisma.invite.findUnique.mockResolvedValue(
        makeInvite({ email: 'intended@example.com' }) as never,
      );

      await expect(
        service.acceptInvite('tok-abc', 'user-2', 'other@example.com', FUTURE),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('requires verified identity for an email-bound invite', async () => {
      prisma.invite.findUnique.mockResolvedValue(
        makeInvite({ email: 'user2@example.com' }) as never,
      );

      await expect(
        service.acceptInvite('tok-abc', 'user-2', 'user2@example.com', null),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('adds the user as a member with the invite role and marks accepted', async () => {
      prisma.invite.findUnique.mockResolvedValue(makeInvite() as never);
      transaction.invite.updateMany.mockResolvedValue({ count: 1 });
      transaction.workspaceMember.findUnique.mockResolvedValue(null);
      transaction.workspaceMember.upsert.mockResolvedValue(BASE_MEMBER);

      const result = await service.acceptInvite(
        'tok-abc',
        'user-2',
        'user2@example.com',
        FUTURE,
      );

      expect(transaction.invite.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'invite-1',
          acceptedAt: null,
          expiresAt: { gt: expect.any(Date) as Date },
        },
        data: { acceptedAt: expect.any(Date) },
      });
      expect(transaction.workspaceMember.upsert).toHaveBeenCalledWith({
        where: {
          workspaceId_userId: { workspaceId: 'ws-1', userId: 'user-2' },
        },
        update: {},
        create: {
          workspaceId: 'ws-1',
          userId: 'user-2',
          role: WorkspaceRole.EDITOR,
        },
      });
      expect(result.alreadyMember).toBe(false);
      expect(result.role).toBe(WorkspaceRole.EDITOR);
      expect(result.workspaceId).toBe('ws-1');
    });

    it('succeeds when the matching user is already a member', async () => {
      prisma.invite.findUnique.mockResolvedValue(makeInvite() as never);
      transaction.invite.updateMany.mockResolvedValue({ count: 1 });
      transaction.workspaceMember.findUnique.mockResolvedValue(BASE_MEMBER);
      transaction.workspaceMember.upsert.mockResolvedValue(BASE_MEMBER);

      const result = await service.acceptInvite(
        'tok-abc',
        'user-2',
        'user2@example.com',
        FUTURE,
      );

      expect(result.alreadyMember).toBe(true);
    });

    it('rejects the transaction when another request already claimed the invite', async () => {
      prisma.invite.findUnique.mockResolvedValue(makeInvite() as never);
      transaction.invite.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.acceptInvite(
          'tok-abc',
          'user-2',
          'user2@example.com',
          FUTURE,
        ),
      ).rejects.toBeInstanceOf(GoneException);
      expect(transaction.workspaceMember.upsert).not.toHaveBeenCalled();
    });
  });
});
