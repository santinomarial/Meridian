import cookieParser from 'cookie-parser';
import {
  BadRequestException,
  PayloadTooLargeException,
  ValidationPipe,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { ErrorRequestHandler } from 'express';

const DEFAULT_JSON_LIMIT = '100kb';
const DOCUMENT_WRITE_JSON_LIMIT = '7mb';
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
  // A one-MiB text document can occupy up to roughly six MiB once JSON escape
  // sequences are applied, so document writes need a larger wire allowance.
  app.use(
    '/workspaces/:workspaceId/documents',
    json({ limit: DOCUMENT_WRITE_JSON_LIMIT }),
  );
  app.use('/documents/:documentId', json({ limit: DOCUMENT_WRITE_JSON_LIMIT }));
  app.use(json({ limit: DEFAULT_JSON_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_JSON_LIMIT }));
  const normalizeParserError: ErrorRequestHandler = (error, _req, _res, next) => {
    const type =
      error !== null && typeof error === 'object' && 'type' in error
        ? error.type
        : undefined;
    if (type === 'entity.too.large') {
      next(new PayloadTooLargeException('Request body is too large'));
      return;
    }
    if (type === 'entity.parse.failed') {
      next(new BadRequestException('Malformed JSON request body'));
      return;
    }
    next(error);
  };
  app.use(normalizeParserError);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
