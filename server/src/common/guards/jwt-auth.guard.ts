import {
  CanActivate,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../modules/auth/types/auth-user.type';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import { toAuthUser } from '../../modules/auth/auth.service';
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
} from '../../modules/auth/auth-cookie';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const { token, fromCookie } = extractToken(request);

    // When the token came from the session cookie and turns out to be dead
    // (expired JWT, revoked session, …), clear the cookie in the 401 response
    // so the browser stops sending it. Expired sessions are a normal state —
    // the next login simply sets a fresh cookie.
    const reject = (message: string): never => {
      if (fromCookie) {
        const response = context.switchToHttp().getResponse<Response>();
        response.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
      }
      throw new UnauthorizedException(message);
    };

    if (token === null) {
      throw new UnauthorizedException('No authentication token provided');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      return reject('Invalid or expired token');
    }

    const session = await this.prisma.session.findUnique({
      where: { jti: payload.jti },
      include: { user: true },
    });

    if (session === null) {
      return reject('Session not found');
    }

    if (session.expiresAt < new Date()) {
      return reject('Session expired');
    }

    if (session.revokedAt !== null) {
      return reject('Session has been revoked');
    }

    const authReq = request as AuthenticatedRequest;
    authReq.user = toAuthUser(session.user);
    authReq.sessionJti = payload.jti;
    return true;
  }
}

function extractToken(request: Request): {
  token: string | null;
  fromCookie: boolean;
} {
  const cookies = request.cookies as Record<string, string> | undefined;
  if (cookies?.[AUTH_COOKIE_NAME]) {
    return { token: cookies[AUTH_COOKIE_NAME], fromCookie: true };
  }

  const auth = request.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return { token: auth.slice(7), fromCookie: false };
  }

  return { token: null, fromCookie: false };
}
