import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

/**
 * Applies the HTTP-layer global configuration shared by the production server
 * (main.ts) and the integration test harness, so tests exercise the exact same
 * request pipeline: cookie parsing + the global validation pipe. (The global
 * exception filter, throttler guard, and request-id middleware come from
 * AppModule providers, so they apply automatically.)
 */
export function configureApp(app: INestApplication): void {
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
