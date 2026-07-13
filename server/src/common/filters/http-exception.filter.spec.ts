import {
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  type ArgumentsHost,
} from '@nestjs/common';
import type { Response } from 'express';
import { mockDeep } from 'jest-mock-extended';
import type { PinoLogger } from 'nestjs-pino';
import type { RequestWithId } from '../types/request-with-id.type';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  function setup() {
    const logger = mockDeep<PinoLogger>();
    const response = mockDeep<Response>();
    response.status.mockReturnValue(response);
    const request = { id: 'request-1', url: '/test' } as RequestWithId;
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as ArgumentsHost;
    const filter = new HttpExceptionFilter(logger);
    return { filter, host, logger, response };
  }

  function responseBody(response: ReturnType<typeof mockDeep<Response>>) {
    return (response.json as jest.Mock).mock.calls[0]?.[0] as {
      statusCode: number;
      error: string;
      message: string | string[];
      requestId: string;
      path: string;
    };
  }

  it('hides raw messages from unhandled errors while retaining them in server logs', () => {
    const { filter, host, logger, response } = setup();
    const error = new Error('database password=top-secret connection failed');

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(responseBody(response)).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
      requestId: 'request-1',
      path: '/test',
    });
    expect(JSON.stringify(responseBody(response))).not.toContain('top-secret');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, statusCode: 500 }),
      'Unhandled HTTP exception',
    );
  });

  it('hides messages from explicit 5xx HttpExceptions', () => {
    const { filter, host, response } = setup();

    filter.catch(new InternalServerErrorException('SQLSTATE 23505: private detail'), host);

    expect(responseBody(response)).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
    expect(JSON.stringify(responseBody(response))).not.toContain('private detail');
  });

  it('preserves client-safe validation messages for 4xx HttpExceptions', () => {
    const { filter, host, logger, response } = setup();
    const messages = ['email must be an email', 'password is too short'];

    filter.catch(new BadRequestException(messages), host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(responseBody(response)).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: messages,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('preserves a client-safe string response from a 4xx HttpException', () => {
    const { filter, host, response } = setup();

    filter.catch(new HttpException('Too many attempts', HttpStatus.TOO_MANY_REQUESTS), host);

    expect(responseBody(response)).toMatchObject({
      statusCode: 429,
      message: 'Too many attempts',
    });
  });

  it('maps body-parser size errors to a safe 413 response', () => {
    const { filter, host, logger, response } = setup();
    const error = Object.assign(new Error('request entity too large: private parser detail'), {
      type: 'entity.too.large',
      status: HttpStatus.PAYLOAD_TOO_LARGE,
    });

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(responseBody(response)).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Request body is too large',
    });
    expect(JSON.stringify(responseBody(response))).not.toContain('private parser detail');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('maps malformed JSON parser errors to a safe 400 response', () => {
    const { filter, host, response } = setup();
    const error = Object.assign(new SyntaxError('Unexpected token with private body fragment'), {
      type: 'entity.parse.failed',
      status: HttpStatus.BAD_REQUEST,
    });

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(responseBody(response)).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Malformed JSON request body',
    });
    expect(JSON.stringify(responseBody(response))).not.toContain('private body fragment');
  });
});
