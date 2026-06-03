import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PinoLogger } from 'nestjs-pino';
import { appConfig, APP_CONFIG_KEY } from './config/app.config';
import { buildLoggerParams } from './config/logger.config';
import type { AppConfig } from './config/configuration.type';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { DocumentsModule } from './documents/documents.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
        return buildLoggerParams(config);
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
        return {
          // Two named throttlers:
          //   'default' — broad limit for all endpoints (120 req / 60s)
          //   'auth'    — stricter limit for login/register (10 req / 60s)
          // Non-auth controllers use @SkipThrottle({ auth: true }) to opt out
          // of the stricter auth throttler.  Auth routes get both by default.
          throttlers: [
            {
              name: 'default',
              ttl: config.httpTtlSeconds * 1000,
              limit: config.httpLimit,
            },
            {
              name: 'auth',
              ttl: config.authTtlSeconds * 1000,
              limit: config.authLimit,
            },
          ],
        };
      },
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    DocumentsModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_FILTER,
      useFactory: (logger: PinoLogger) => new HttpExceptionFilter(logger),
      inject: [PinoLogger],
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
