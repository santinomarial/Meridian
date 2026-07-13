import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Workspace, WorkspaceMember } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService, type CreateWorkspaceData } from './workspaces.service';
import { RealtimeAuthorizationService } from '../modules/realtime-authorization/realtime-authorization.service';

const BASE_WORKSPACE: Workspace = {
  id: 'ws-1',
  name: 'Meridian',
  ownerId: 'user-1',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const BASE_MEMBER: WorkspaceMember = {
  id: 'member-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  role: WorkspaceRole.OWNER,
  createdAt: new Date('2024-01-01'),
};

const EDITOR_MEMBER: WorkspaceMember = {
  ...BASE_MEMBER,
  id: 'member-2',
  userId: 'user-2',
  role: WorkspaceRole.EDITOR,
};

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let prisma: DeepMockProxy<PrismaService>;
  let realtimeAuthorization: DeepMockProxy<RealtimeAuthorizationService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    realtimeAuthorization = mockDeep<RealtimeAuthorizationService>();
    service = new WorkspacesService(prisma, realtimeAuthorization);
  });

  describe('createWorkspace', () => {
    beforeEach(() => {
      // createWorkspace runs inside a $transaction callback. This mock executes
      // the callback immediately with `prisma` as the transaction client so
      // inner calls can be asserted via the same mock object.
      prisma.$transaction.mockImplementation(
        ((fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never,
      );
    });

    it('creates the workspace and adds owner as OWNER member in a transaction', async () => {
      const data: CreateWorkspaceData = { name: 'Meridian', ownerId: 'user-1' };
      prisma.workspace.create.mockResolvedValue(BASE_WORKSPACE);
      prisma.workspaceMember.create.mockResolvedValue(BASE_MEMBER);

      const result = await service.createWorkspace(data);

      expect(prisma.workspace.create).toHaveBeenCalledWith({ data });
      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          userId: 'user-1',
          role: WorkspaceRole.OWNER,
        },
      });
      expect(result).toEqual(BASE_WORKSPACE);
    });

    it('executes workspace and member creation in a single transaction', async () => {
      const data: CreateWorkspaceData = { name: 'Meridian', ownerId: 'user-1' };
      prisma.workspace.create.mockResolvedValue(BASE_WORKSPACE);
      prisma.workspaceMember.create.mockResolvedValue(BASE_MEMBER);

      await service.createWorkspace(data);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('findById', () => {
    it('returns the workspace when found', async () => {
      prisma.workspace.findUnique.mockResolvedValue(BASE_WORKSPACE);

      const result = await service.findById('ws-1');

      expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
      });
      expect(result).toEqual(BASE_WORKSPACE);
    });

    it('returns null when not found', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      expect(await service.findById('missing')).toBeNull();
    });
  });

  describe('listForUser', () => {
    it('returns workspaces where the user is a member', async () => {
      prisma.workspace.findMany.mockResolvedValue([BASE_WORKSPACE]);

      const result = await service.listForUser('user-1');

      expect(prisma.workspace.findMany).toHaveBeenCalledWith({
        where: { members: { some: { userId: 'user-1' } } },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([BASE_WORKSPACE]);
    });

    it('returns empty array when user has no memberships', async () => {
      prisma.workspace.findMany.mockResolvedValue([]);

      expect(await service.listForUser('user-99')).toEqual([]);
    });
  });

  describe('addMember', () => {
    it('creates and returns the membership record', async () => {
      prisma.workspaceMember.create.mockResolvedValue(EDITOR_MEMBER);

      const result = await service.addMember('ws-1', 'user-2', WorkspaceRole.EDITOR);

      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 'user-2', role: WorkspaceRole.EDITOR },
      });
      expect(result).toEqual(EDITOR_MEMBER);
    });

    it('rejects assigning OWNER through the generic member API', async () => {
      await expect(
        service.addMember('ws-1', 'user-2', WorkspaceRole.OWNER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.workspaceMember.create).not.toHaveBeenCalled();
    });
  });

  describe('updateMemberRole', () => {
    it('updates a regular member to another non-owner role', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        userId: 'user-2',
        workspaceId: 'ws-1',
        role: WorkspaceRole.EDITOR,
        workspace: { ownerId: 'user-1' },
      } as never);
      prisma.workspaceMember.update.mockResolvedValue({
        ...EDITOR_MEMBER,
        role: WorkspaceRole.VIEWER,
      });

      await service.updateMemberRole('member-2', WorkspaceRole.VIEWER);

      expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
        where: { id: 'member-2' },
        data: { role: WorkspaceRole.VIEWER },
      });
      expect(realtimeAuthorization.invalidateWorkspaceAccess).toHaveBeenCalledWith(
        'ws-1',
        'user-2',
      );
    });

    it('rejects promoting any membership to OWNER', async () => {
      await expect(
        service.updateMemberRole('member-2', WorkspaceRole.OWNER),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
      expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
    });

    it('rejects demoting the canonical owner membership', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: WorkspaceRole.OWNER,
        workspace: { ownerId: 'user-1' },
      } as never);

      await expect(
        service.updateMemberRole('member-1', WorkspaceRole.EDITOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
    });

    it('rejects mutating the canonical owner even if its role is malformed', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: WorkspaceRole.EDITOR,
        workspace: { ownerId: 'user-1' },
      } as never);

      await expect(
        service.updateMemberRole('member-1', WorkspaceRole.VIEWER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('removeMember', () => {
    it('removes a regular member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        userId: 'user-2',
        workspaceId: 'ws-1',
        role: WorkspaceRole.EDITOR,
        workspace: { ownerId: 'user-1' },
      } as never);
      prisma.workspaceMember.delete.mockResolvedValue(EDITOR_MEMBER);

      await service.removeMember('member-2');

      expect(prisma.workspaceMember.delete).toHaveBeenCalledWith({
        where: { id: 'member-2' },
      });
      expect(realtimeAuthorization.invalidateWorkspaceAccess).toHaveBeenCalledWith(
        'ws-1',
        'user-2',
      );
    });

    it('rejects removing the owner membership', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        userId: 'user-1',
        workspaceId: 'ws-1',
        role: WorkspaceRole.OWNER,
        workspace: { ownerId: 'user-1' },
      } as never);

      await expect(service.removeMember('member-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.workspaceMember.delete).not.toHaveBeenCalled();
    });

    it('returns NotFound for an unknown membership', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.removeMember('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('canUserAccessWorkspace', () => {
    it('returns true when the user is a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(
        BASE_MEMBER as never,
      );

      const result = await service.canUserAccessWorkspace('user-1', 'ws-1');

      expect(result).toBe(true);
    });

    it('returns false when the user is not a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      const result = await service.canUserAccessWorkspace('user-99', 'ws-1');

      expect(result).toBe(false);
    });
  });

  describe('canUserAccessDocument', () => {
    it('returns true when the document exists and user is a member', async () => {
      prisma.document.findUnique.mockResolvedValue(
        { workspaceId: 'ws-1' } as never,
      );
      prisma.workspaceMember.findUnique.mockResolvedValue(
        BASE_MEMBER as never,
      );

      const result = await service.canUserAccessDocument('user-1', 'doc-1');

      expect(result).toBe(true);
    });

    it('returns false when the document does not exist', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      const result = await service.canUserAccessDocument('user-1', 'ghost-doc');

      expect(result).toBe(false);
      expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
    });

    it('returns false when the document exists but user is not a member', async () => {
      prisma.document.findUnique.mockResolvedValue(
        { workspaceId: 'ws-1' } as never,
      );
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      const result = await service.canUserAccessDocument('user-99', 'doc-1');

      expect(result).toBe(false);
    });
  });

  describe('getMemberRole', () => {
    it('returns the role when user is a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(
        { role: WorkspaceRole.EDITOR } as never,
      );
      expect(await service.getMemberRole('user-1', 'ws-1')).toBe(WorkspaceRole.EDITOR);
    });

    it('returns null when the user is not a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      expect(await service.getMemberRole('user-99', 'ws-1')).toBeNull();
    });
  });

  describe('canEditWorkspace', () => {
    it.each([
      [WorkspaceRole.OWNER, true],
      [WorkspaceRole.EDITOR, true],
      [WorkspaceRole.VIEWER, false],
    ])('returns %s for role %s', async (role, expected) => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ role } as never);
      expect(await service.canEditWorkspace('user-1', 'ws-1')).toBe(expected);
    });

    it('returns false for non-member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      expect(await service.canEditWorkspace('user-99', 'ws-1')).toBe(false);
    });
  });

  describe('canManageWorkspace', () => {
    it('returns true for OWNER', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(
        {
          role: WorkspaceRole.OWNER,
          workspace: { ownerId: 'user-1' },
        } as never,
      );
      expect(await service.canManageWorkspace('user-1', 'ws-1')).toBe(true);
    });

    it.each([WorkspaceRole.EDITOR, WorkspaceRole.VIEWER])(
      'returns false for %s',
      async (role) => {
        prisma.workspaceMember.findUnique.mockResolvedValue({
          role,
          workspace: { ownerId: 'user-1' },
        } as never);
        expect(await service.canManageWorkspace('user-1', 'ws-1')).toBe(false);
      },
    );

    it('returns false for a legacy extra OWNER membership', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: WorkspaceRole.OWNER,
        workspace: { ownerId: 'user-1' },
      } as never);

      expect(await service.canManageWorkspace('user-2', 'ws-1')).toBe(false);
    });

    it('returns false for non-member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      expect(await service.canManageWorkspace('user-99', 'ws-1')).toBe(false);
    });
  });

  describe('getDocumentAccessInfo', () => {
    it('returns null when document does not exist', async () => {
      prisma.document.findUnique.mockResolvedValue(null);
      expect(await service.getDocumentAccessInfo('user-1', 'ghost')).toBeNull();
      expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when user is not a member', async () => {
      prisma.document.findUnique.mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      expect(await service.getDocumentAccessInfo('user-99', 'doc-1')).toBeNull();
    });

    it('returns workspaceId and role when authorized', async () => {
      prisma.document.findUnique.mockResolvedValue({ workspaceId: 'ws-1' } as never);
      prisma.workspaceMember.findUnique.mockResolvedValue(
        { role: WorkspaceRole.VIEWER } as never,
      );
      const result = await service.getDocumentAccessInfo('user-1', 'doc-1');
      expect(result).toEqual({ workspaceId: 'ws-1', role: WorkspaceRole.VIEWER });
    });

    it.each([WorkspaceRole.OWNER, WorkspaceRole.EDITOR, WorkspaceRole.VIEWER])(
      'returns the correct role for %s members',
      async (role) => {
        prisma.document.findUnique.mockResolvedValue({ workspaceId: 'ws-1' } as never);
        prisma.workspaceMember.findUnique.mockResolvedValue({ role } as never);
        const result = await service.getDocumentAccessInfo('user-1', 'doc-1');
        expect(result?.role).toBe(role);
      },
    );
  });
});
