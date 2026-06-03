import {
  CanActivate,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../modules/auth/types/auth-user.type';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import { toAuthUser } from '../../modules/auth/auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractToken(request);

    if (token === null) {
      throw new UnauthorizedException('No authentication token provided');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const session = await this.prisma.session.findUnique({
      where: { jti: payload.jti },
      include: { user: true },
    });

    if (session === null) {
      throw new UnauthorizedException('Session not found');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    if (session.revokedAt !== null) {
      throw new UnauthorizedException('Session has been revoked');
    }

    const authReq = request as AuthenticatedRequest;
    authReq.user = toAuthUser(session.user);
    authReq.sessionJti = payload.jti;
    return true;
  }
}

function extractToken(request: Request): string | null {
  const cookies = request.cookies as Record<string, string> | undefined;
  if (cookies?.['auth_token']) return cookies['auth_token'];

  const auth = request.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7);
  }

  return null;
}
