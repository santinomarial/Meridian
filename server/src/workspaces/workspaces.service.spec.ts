import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Workspace, WorkspaceMember } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspacesService, type CreateWorkspaceData } from './workspaces.service';

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

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new WorkspacesService(prisma);
  });

  describe('createWorkspace', () => {
    it('creates and returns the workspace', async () => {
      const data: CreateWorkspaceData = { name: 'Meridian', ownerId: 'user-1' };
      prisma.workspace.create.mockResolvedValue(BASE_WORKSPACE);

      const result = await service.createWorkspace(data);

      expect(prisma.workspace.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(BASE_WORKSPACE);
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
      prisma.workspaceMember.create.mockResolvedValue(BASE_MEMBER);

      const result = await service.addMember('ws-1', 'user-1', WorkspaceRole.OWNER);

      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 'user-1', role: WorkspaceRole.OWNER },
      });
      expect(result).toEqual(BASE_MEMBER);
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
});
