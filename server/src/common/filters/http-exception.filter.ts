import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type { RequestWithId } from '../types/request-with-id.type';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId: string;
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<Response>();

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const httpError =
      exception instanceof HttpException ? exception.getResponse() : null;

    const message: string | string[] =
      httpError !== null && typeof httpError === 'object' && 'message' in httpError
        ? (httpError as { message: string | string[] }).message
        : exception instanceof Error
          ? exception.message
          : 'Internal server error';

    const errorLabel =
      httpError !== null && typeof httpError === 'object' && 'error' in httpError
        ? String((httpError as { error: string }).error)
        : HttpStatus[statusCode] ?? 'Internal Server Error';

    const body: ErrorResponseBody = {
      statusCode,
      error: errorLabel,
      message,
      requestId: req.id ?? '',
      timestamp: new Date().toISOString(),
      path: req.url,
    };

    if (statusCode >= 500) {
      this.logger.error(
        { requestId: body.requestId, statusCode, path: body.path },
        exception instanceof Error ? exception.message : 'Unhandled exception',
      );
    } else {
      this.logger.warn(
        { requestId: body.requestId, statusCode, path: body.path },
        typeof message === 'string' ? message : message.join(', '),
      );
    }

    res.status(statusCode).json(body);
  }
}
