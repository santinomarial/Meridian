import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { MailModule } from '../mail/mail.module';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

// @Global ensures JwtService and JwtAuthGuard are injectable in every module
// without each feature module needing to import AuthModule explicitly.
@Global()
@Module({
  imports: [
    MailModule,
    JwtModule.registerAsync({
      // global: true makes JwtService available in every module without
      // needing to re-export JwtModule from AuthModule.  This avoids the
      // UnknownExportException that NestJS throws when a @Global() module
      // tries to re-export a dynamic module token via exports: [JwtModule].
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
        return {
          secret: config.jwtSecret,
          // expiresIn must be a number (seconds) to satisfy the StringValue | number
          // union in JwtSignOptions without importing the ms@3 StringValue brand type.
          signOptions: { expiresIn: parseExpiresInSeconds(config.jwtExpiresIn) },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}

// ---------------------------------------------------------------------------

function parseExpiresInSeconds(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d|w|y)$/.exec(value);
  if (match === null) {
    throw new Error(
      `Cannot parse JWT_EXPIRES_IN "${value}" — expected a value like 15m, 1h, 7d`,
    );
  }
  const n = parseInt(match[1]!, 10);
  const unit = match[2]!;
  switch (unit) {
    case 'ms': return Math.ceil(n / 1000);
    case 's':  return n;
    case 'm':  return n * 60;
    case 'h':  return n * 3_600;
    case 'd':  return n * 86_400;
    case 'w':  return n * 604_800;
    case 'y':  return n * 31_536_000;
    default:   throw new Error(`Unknown time unit: ${unit}`);
  }
}
