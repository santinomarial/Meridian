import { ArgumentsHost, BadRequestException, Catch } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

interface ValidationErrorResponse {
  message: string | string[];
  error?: string;
}

@Catch(BadRequestException)
export class WsValidationFilter extends BaseWsExceptionFilter {
  override catch(exception: BadRequestException, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const response = exception.getResponse() as ValidationErrorResponse | string;

    const message =
      typeof response === 'object' ? response.message : response;

    client.emit('error', { message });
  }
}
