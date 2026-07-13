import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeAuthorizationService } from '../modules/realtime-authorization/realtime-authorization.service';
import { UsersService, type CreateUserData } from './users.service';

const BASE_USER: User = {
  id: 'user-1',
  email: 'alice@meridian.dev',
  displayName: 'Alice Chen',
  passwordHash: null,
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: DeepMockProxy<PrismaService>;
  let realtimeAuthorization: DeepMockProxy<RealtimeAuthorizationService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    realtimeAuthorization = mockDeep<RealtimeAuthorizationService>();
    realtimeAuthorization.invalidateUser.mockResolvedValue(undefined);
    service = new UsersService(prisma, realtimeAuthorization);
  });

  describe('createUser', () => {
    it('creates and returns the new user', async () => {
      const data: CreateUserData = {
        email: 'alice@meridian.dev',
        displayName: 'Alice Chen',
      };
      prisma.user.create.mockResolvedValue(BASE_USER);

      const result = await service.createUser(data);

      expect(prisma.user.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(BASE_USER);
    });
  });

  describe('findByEmail', () => {
    it('returns the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(BASE_USER);

      const result = await service.findByEmail('alice@meridian.dev');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'alice@meridian.dev' },
      });
      expect(result).toEqual(BASE_USER);
    });

    it('returns null when not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('nobody@meridian.dev');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(BASE_USER);

      const result = await service.findById('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(result).toEqual(BASE_USER);
    });

    it('returns null when not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('listUsers', () => {
    it('returns all users ordered by createdAt', async () => {
      const users = [BASE_USER, { ...BASE_USER, id: 'user-2', email: 'bob@meridian.dev' }];
      prisma.user.findMany.mockResolvedValue(users);

      const result = await service.listUsers();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no users exist', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.listUsers();

      expect(result).toEqual([]);
    });
  });

  describe('deleteUser', () => {
    it('atomically deletes owned workspaces before deleting the account', async () => {
      prisma.workspace.deleteMany.mockResolvedValue({ count: 2 });
      prisma.user.delete.mockResolvedValue(BASE_USER);
      prisma.workspaceMember.findMany.mockResolvedValue([
        { workspaceId: 'workspace-1', userId: 'collaborator-1' },
      ] as never);
      prisma.$transaction.mockResolvedValue([
        [{ workspaceId: 'workspace-1', userId: 'collaborator-1' }],
        { count: 2 },
        BASE_USER,
      ]);

      await service.deleteUser(BASE_USER.id);

      expect(prisma.workspace.deleteMany).toHaveBeenCalledWith({
        where: { ownerId: BASE_USER.id },
      });
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: BASE_USER.id },
      });
      expect(prisma.$transaction).toHaveBeenCalledWith([
        expect.anything(),
        expect.anything(),
        expect.anything(),
      ]);
      expect(realtimeAuthorization.invalidateUser).toHaveBeenCalledWith(BASE_USER.id);
      expect(
        realtimeAuthorization.invalidateWorkspaceAccess,
      ).toHaveBeenCalledWith('workspace-1', 'collaborator-1');
    });
  });
});
