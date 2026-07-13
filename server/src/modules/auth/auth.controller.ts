import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from './types/auth-user.type';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { E2eResetTokenDto } from '../../e2e/e2e.dto';
import { assertTestEmail, E2eOnlyGuard } from '../../e2e/e2e-safety';

const FORGOT_SUCCESS =
  'If an account exists for this email, a reset link has been sent.';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new account' })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser; token: string }> {
    return this.authService.register(dto, res);
  }

  @ApiOperation({ summary: 'Log in with email and password' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: AuthUser; token: string }> {
    return this.authService.login(dto, res);
  }

  @ApiOperation({ summary: 'Get the currently authenticated user' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @ApiOperation({ summary: 'Revoke the current session and clear the cookie' })
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(req.sessionJti, res);
  }

  // ── Password reset ──────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Request a password reset email' })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto);
    // Always return the same generic message — never reveal whether the email exists.
    return { message: FORGOT_SUCCESS };
  }

  @ApiOperation({ summary: 'Complete a password reset using the token from the email link' })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto);
    return { message: 'Password reset successfully.' };
  }

  // ── E2E test helper — only works when E2E_TEST=true ─────────────────────────

  @ApiExcludeEndpoint()
  @Post('e2e/password-reset-token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(E2eOnlyGuard)
  async e2eGetResetToken(
    @Body() dto: E2eResetTokenDto,
  ): Promise<{ token: string; resetUrl: string }> {
    const email = assertTestEmail(dto.email);
    return this.authService.generateResetTokenForE2E(email);
  }
}
