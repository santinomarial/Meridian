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
import { DocumentManagerService } from './document-manager.service';
import { JoinDocumentDto } from './dto/join-document.dto';
import { LeaveDocumentDto } from './dto/leave-document.dto';
import { YjsUpdateDto } from './dto/yjs-update.dto';
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
    private readonly documentManager: DocumentManagerService,
    @InjectPinoLogger(EditorGateway.name)
    private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

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
    const documentIds = this.registry.getDocumentsForSocket(client.id);

    for (const documentId of documentIds) {
      // Notify peers before the socket is gone from rooms.
      client.to(`document:${documentId}`).emit('userLeft', {
        documentId,
        socketId: client.id,
      });
      this.documentManager.release(documentId);
    }

    this.registry.disconnect(client.id);

    this.logger.info({ socketId: client.id }, 'Socket disconnected');
  }

  // ---------------------------------------------------------------------------
  // Room events
  // ---------------------------------------------------------------------------

  @SubscribeMessage('joinDocument')
  async handleJoinDocument(
    @MessageBody() dto: JoinDocumentDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const room = `document:${dto.documentId}`;

    await client.join(room);
    this.registry.join(client.id, dto.documentId);

    // Acquire the authoritative Y.Doc (creates it if not yet in memory).
    this.documentManager.acquire(dto.documentId);

    // Send the current document state to the joining client so it can
    // initialise its local Y.Doc and catch up with any prior edits.
    const state = this.documentManager.getState(dto.documentId);
    client.emit('yjs:state', { documentId: dto.documentId, state });

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
    this.documentManager.release(dto.documentId);

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

  // ---------------------------------------------------------------------------
  // Yjs collaboration
  // ---------------------------------------------------------------------------

  @SubscribeMessage('yjs:update')
  handleYjsUpdate(
    @MessageBody() dto: YjsUpdateDto,
    @ConnectedSocket() client: Socket,
  ): void {
    const update = toUint8Array(dto.update);

    if (update === null) {
      client.emit('error', { message: 'yjs:update — update must be binary data' });
      return;
    }

    // Apply the update to the server-authoritative Y.Doc.
    this.documentManager.applyUpdate(dto.documentId, update);

    // Relay the raw update to every OTHER socket in the document room.
    //
    // Echo suppression: the sending client has already applied this update
    // to its own local Y.Doc. Re-sending it back would cause the client to
    // apply the same update twice, leading to duplicated content or spurious
    // state-vector growth. Other clients still receive the update and merge
    // it into their own docs via Y.applyUpdate.
    const room = `document:${dto.documentId}`;
    client.to(room).emit('yjs:update', {
      documentId: dto.documentId,
      update,
    });

    this.logger.debug(
      { socketId: client.id, documentId: dto.documentId, bytes: update.byteLength },
      'Yjs update relayed',
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value; // covers Buffer (Node.js subclass)
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}
