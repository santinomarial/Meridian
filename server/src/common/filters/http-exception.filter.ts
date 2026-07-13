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

interface ParserErrorDetails {
  statusCode: HttpStatus.BAD_REQUEST | HttpStatus.PAYLOAD_TOO_LARGE;
  error: 'Bad Request' | 'Payload Too Large';
  message: string;
}

function getParserErrorDetails(exception: unknown): ParserErrorDetails | null {
  if (exception === null || typeof exception !== 'object') return null;

  const type = 'type' in exception ? exception.type : undefined;
  const status = 'status' in exception ? exception.status : undefined;

  if (type === 'entity.too.large' && status === HttpStatus.PAYLOAD_TOO_LARGE) {
    return {
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      error: 'Payload Too Large',
      message: 'Request body is too large',
    };
  }

  if (type === 'entity.parse.failed' && status === HttpStatus.BAD_REQUEST) {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: 'Malformed JSON request body',
    };
  }

  return null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<Response>();
    const parserError = getParserErrorDetails(exception);

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : parserError !== null
          ? parserError.statusCode
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const httpError =
      exception instanceof HttpException ? exception.getResponse() : null;

    // 5xx responses must never expose raw exception/database/provider details.
    // Client-actionable 4xx HttpExceptions retain their intentional messages.
    const isServerError = statusCode >= HttpStatus.INTERNAL_SERVER_ERROR;

    const message: string | string[] =
      isServerError
        ? 'Internal server error'
        : parserError !== null
          ? parserError.message
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
        : parserError !== null
          ? parserError.error
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
