import { Injectable, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Server, Socket } from 'socket.io';
import { ConnectionRegistryService } from './connection-registry.service';
import { JoinDocumentDto } from './dto/join-document.dto';
import { LeaveDocumentDto } from './dto/leave-document.dto';
import { WsValidationFilter } from './filters/ws-exception.filter';

// CORS is configured on the IoAdapter in main.ts so it reads from typed config.
@WebSocketGateway()
@Injectable()
@UseFilters(new WsValidationFilter())
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
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
    // Notify all document rooms the socket was in before registry is cleared.
    for (const documentId of this.registry.getDocumentsForSocket(client.id)) {
      client.to(`document:${documentId}`).emit('userLeft', {
        documentId,
        socketId: client.id,
      });
    }

    this.registry.disconnect(client.id);

    this.logger.info({ socketId: client.id }, 'Socket disconnected');
  }

  @SubscribeMessage('joinDocument')
  async handleJoinDocument(
    @MessageBody() dto: JoinDocumentDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const room = `document:${dto.documentId}`;

    await client.join(room);
    this.registry.join(client.id, dto.documentId);

    // Notify peers already in the room.
    client.to(room).emit('userJoined', {
      documentId: dto.documentId,
      socketId: client.id,
      userId: dto.userId,
      displayName: dto.displayName,
    });

    // Acknowledge to the joining socket.
    client.emit('joinedDocument', {
      documentId: dto.documentId,
      socketId: client.id,
    });

    this.logger.info(
      { socketId: client.id, documentId: dto.documentId, userId: dto.userId },
      'Socket joined document',
    );
  }

  @SubscribeMessage('leaveDocument')
  async handleLeaveDocument(
    @MessageBody() dto: LeaveDocumentDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const room = `document:${dto.documentId}`;

    await client.leave(room);
    this.registry.leave(client.id, dto.documentId);

    // Notify remaining room members.
    this.server.to(room).emit('userLeft', {
      documentId: dto.documentId,
      socketId: client.id,
    });

    this.logger.info(
      { socketId: client.id, documentId: dto.documentId },
      'Socket left document',
    );
  }
}
