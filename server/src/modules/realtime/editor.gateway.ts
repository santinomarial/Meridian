import { Injectable } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Server, Socket } from 'socket.io';
import { ConnectionRegistryService } from './connection-registry.service';

// CORS is configured on the IoAdapter in main.ts so it reads from typed config.
@WebSocketGateway()
@Injectable()
export class EditorGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly registry: ConnectionRegistryService,
    @InjectPinoLogger(EditorGateway.name)
    private readonly logger: PinoLogger,
  ) {}

  handleConnection(client: Socket): void {
    const requestId = client.handshake.headers['x-request-id'];
    const requestIdStr = Array.isArray(requestId) ? requestId[0] : requestId;

    this.registry.register(client.id);

    this.logger.info(
      { socketId: client.id, requestId: requestIdStr },
      'Socket connected',
    );
  }

  handleDisconnect(client: Socket): void {
    this.registry.disconnect(client.id);

    this.logger.info({ socketId: client.id }, 'Socket disconnected');
  }
}
