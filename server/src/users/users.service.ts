import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateUserData {
  email: string;
  displayName: string;
  passwordHash?: string;
  avatarUrl?: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
}
