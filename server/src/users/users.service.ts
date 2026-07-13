import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeAuthorizationService } from '../modules/realtime-authorization/realtime-authorization.service';

export interface CreateUserData {
  email: string;
  displayName: string;
  passwordHash?: string;
  avatarUrl?: string;
}

export interface UpdateUserData {
  displayName?: string;
  avatarUrl?: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeAuthorization: RealtimeAuthorizationService,
  ) {}

  async createUser(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({ data });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async listUsers(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async updateUser(id: string, data: UpdateUserData): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async deleteUser(id: string): Promise<void> {
    // Workspace.ownerId intentionally uses RESTRICT semantics so an owner can
    // never disappear while their workspace survives. Account deletion owns
    // the broader lifecycle: remove owned workspaces and the user atomically.
    const [affectedMemberships] = await this.prisma.$transaction([
      this.prisma.workspaceMember.findMany({
        where: { workspace: { ownerId: id } },
        select: { workspaceId: true, userId: true },
      }),
      this.prisma.workspace.deleteMany({ where: { ownerId: id } }),
      this.prisma.user.delete({ where: { id } }),
    ]);
    await Promise.all([
      this.realtimeAuthorization.invalidateUser(id),
      ...affectedMemberships.map(({ workspaceId, userId }) =>
        this.realtimeAuthorization.invalidateWorkspaceAccess(workspaceId, userId),
      ),
    ]);
  }
}
