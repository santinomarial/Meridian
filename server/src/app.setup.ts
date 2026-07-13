import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

const DEFAULT_JSON_LIMIT = '100kb';
const BULK_IMPORT_JSON_LIMIT = '26mb';

/**
 * Applies the HTTP-layer global configuration shared by the production server
 * (main.ts) and the integration test harness, so tests exercise the exact same
 * request pipeline: route-scoped body parsing, cookie parsing, and the global
 * validation pipe. The application must be created with `bodyParser: false`
 * so the default 100 KB parser does not reject a valid bulk import first. (The
 * global exception filter, throttler guard, and request-id middleware come
 * from AppModule providers, so they apply automatically.)
 */
export function configureApp(app: INestApplication): void {
  app.use(
    '/workspaces/:workspaceId/documents/bulk',
    json({ limit: BULK_IMPORT_JSON_LIMIT }),
  );
  app.use(json({ limit: DEFAULT_JSON_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_JSON_LIMIT }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
