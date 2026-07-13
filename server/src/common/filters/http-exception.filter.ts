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

    // 5xx responses must never expose raw exception/database/provider details.
    // Client-actionable 4xx HttpExceptions retain their intentional messages.
    const isServerError = statusCode >= HttpStatus.INTERNAL_SERVER_ERROR;

    const message: string | string[] =
      isServerError
        ? 'Internal server error'
        : typeof httpError === 'string'
          ? httpError
          : httpError !== null && typeof httpError === 'object' && 'message' in httpError
            ? (httpError as { message: string | string[] }).message
            : exception instanceof Error
              ? exception.message
              : 'Request failed';

    const errorLabel =
      isServerError
        ? 'Internal Server Error'
        : httpError !== null && typeof httpError === 'object' && 'error' in httpError
          ? String((httpError as { error: string }).error)
          : HttpStatus[statusCode] ?? 'Request Error';

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
        { requestId: body.requestId, statusCode, path: body.path, err: exception },
        'Unhandled HTTP exception',
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
