import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser, JwtPayload } from './types/auth-user.type';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';

const COOKIE_NAME = 'auth_token';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @InjectPinoLogger(AuthService.name)
    private readonly logger: PinoLogger,
  ) {}

  async register(
    dto: RegisterDto,
    res: Response,
  ): Promise<{ user: AuthUser; token: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing !== null) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const user = await this.prisma.user.create({
      data: { email: dto.email, displayName: dto.displayName, passwordHash },
    });

    const token = await this.createSession(user, res);
    this.logger.info({ userId: user.id }, 'User registered');
    return { user: toAuthUser(user), token };
  }

  async login(
    dto: LoginDto,
    res: Response,
  ): Promise<{ user: AuthUser; token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Constant-time path: always run hash verification even when user is null
    // so email enumeration via timing difference is not possible.
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const hashToCheck = user?.passwordHash ?? dummyHash;

    const valid = await argon2.verify(hashToCheck, dto.password);

    if (user === null || user.passwordHash === null || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = await this.createSession(user, res);
    this.logger.info({ userId: user.id }, 'User logged in');
    return { user: toAuthUser(user), token };
  }

  async logout(jti: string, res: Response): Promise<void> {
    await this.prisma.session.update({
      where: { jti },
      data: { revokedAt: new Date() },
    });
    res.clearCookie(COOKIE_NAME, cookieOptions());
    this.logger.info({ jti }, 'Session revoked');
  }

  // ---------------------------------------------------------------------------

  private async createSession(user: User, res: Response): Promise<string> {
    const jti = randomUUID();

    const payload: JwtPayload = { sub: user.id, email: user.email, jti };
    const token = this.jwtService.sign(payload);

    // Derive expiresAt from the signed token's exp claim so the session row
    // and the JWT always agree on expiry without re-parsing JWT_EXPIRES_IN.
    const decoded = this.jwtService.decode(token) as JwtPayload & {
      exp: number;
    };
    const expiresAt = new Date(decoded.exp * 1000);

    await this.prisma.session.create({
      data: { userId: user.id, jti, expiresAt },
    });

    res.cookie(COOKIE_NAME, token, {
      ...cookieOptions(),
      maxAge: expiresAt.getTime() - Date.now(),
    });

    this.logger.debug({ jti, expiresAt }, 'Session created');
    return token;
  }
}

// ---------------------------------------------------------------------------

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
  };
}
