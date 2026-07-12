import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser, JwtPayload } from './types/auth-user.type';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from '../mail/mail.service';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';
import { AUTH_COOKIE_NAME, authCookieOptions } from './auth-cookie';

@Injectable()
export class AuthService {
  private readonly clientOrigin: string;
  private readonly resetTokenTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    @InjectPinoLogger(AuthService.name)
    private readonly logger: PinoLogger,
  ) {
    const config = this.configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.clientOrigin = config.clientOrigin;
    this.resetTokenTtlMs = config.forgotPasswordTtlMinutes * 60 * 1_000;
  }

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
    res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
    this.logger.info({ jti }, 'Session revoked');
  }

  // ---------------------------------------------------------------------------
  // Password reset
  // ---------------------------------------------------------------------------

  /**
   * Initiates a password reset for the given email.
   * Always returns void — never reveals whether the email exists in the system.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (user === null) {
      // Silently succeed — do not reveal that this email doesn't exist.
      return;
    }

    // Invalidate any active tokens for this user so only one is valid at a time.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.resetTokenTtlMs);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const resetUrl = `${this.clientOrigin}/reset-password/${rawToken}`;

    try {
      await this.mailService.sendPasswordResetEmail(user.email, resetUrl);
    } catch (err) {
      // Log but do not propagate — the caller still returns a generic success
      // response so user existence is never exposed.
      this.logger.error(
        { userId: user.id, err: (err as Error).message },
        'Failed to send password reset email',
      );
    }
  }

  /**
   * Completes a password reset using the raw token from the reset URL.
   * Throws BadRequestException for any invalid/expired/used token — no detail
   * beyond the generic message is returned to the caller.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');

    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (
      tokenRecord === null ||
      tokenRecord.usedAt !== null ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new BadRequestException('Reset link is invalid or expired.');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    await this.prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { passwordHash },
    });

    // Mark this token used and invalidate any remaining ones for this user.
    await this.prisma.passwordResetToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date() },
    });
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: tokenRecord.userId, id: { not: tokenRecord.id }, usedAt: null },
      data: { usedAt: new Date() },
    });

    this.logger.info({ userId: tokenRecord.userId }, 'Password reset completed');
  }

  // ---------------------------------------------------------------------------
  // E2E test helper — ONLY active when E2E_TEST=true
  // ---------------------------------------------------------------------------

  /**
   * Creates a fresh reset token for a user and returns the raw token.
   * Never sends an email. Used exclusively by Playwright E2E tests.
   * Calling this in production has no effect beyond returning a 404 from
   * the controller guard.
   */
  async generateResetTokenForE2E(
    email: string,
  ): Promise<{ token: string; resetUrl: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user === null) {
      throw new BadRequestException('User not found');
    }

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + this.resetTokenTtlMs);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const resetUrl = `${this.clientOrigin}/reset-password/${rawToken}`;
    return { token: rawToken, resetUrl };
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

    // Login/register always sets a fresh cookie, replacing any stale one the
    // browser may still hold from an expired session.
    res.cookie(AUTH_COOKIE_NAME, token, {
      ...authCookieOptions(),
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
