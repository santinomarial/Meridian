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
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { JoinDocumentDto } from './dto/join-document.dto';
import { LeaveDocumentDto } from './dto/leave-document.dto';
import { YjsUpdateDto } from './dto/yjs-update.dto';
import { YjsSyncDto } from './dto/yjs-sync.dto';
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

    // Acquire the authoritative Y.Doc (creates it on first join).
    this.documentManager.acquire(dto.documentId);

    // Sync step 1: send the server's state vector to the joining client.
    //
    // A state vector is a compact summary of which updates a replica already
    // has (clock per client-id). The client uses it to compute only the
    // updates the server is missing and sends them back as sync step 2.
    // This avoids resending the whole document to late joiners — only the
    // delta (what the client has that the server doesn't) travels over the
    // wire, and the server sends its own delta back.
    const doc = this.documentManager.getDoc(dto.documentId)!;
    const step1Encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(step1Encoder, doc);
    client.emit('yjs:sync', {
      documentId: dto.documentId,
      message: encoding.toUint8Array(step1Encoder),
    });

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
  // Yjs sync protocol
  // ---------------------------------------------------------------------------

  @SubscribeMessage('yjs:sync')
  handleYjsSync(
    @MessageBody() dto: YjsSyncDto,
    @ConnectedSocket() client: Socket,
  ): void {
    const message = toUint8Array(dto.message);
    if (message === null) {
      client.emit('error', { message: 'yjs:sync — message must be binary data' });
      return;
    }

    const doc = this.documentManager.getDoc(dto.documentId);
    if (doc === undefined) {
      client.emit('error', {
        message: `yjs:sync — document ${dto.documentId} not in memory; send joinDocument first`,
      });
      return;
    }

    const decoder = decoding.createDecoder(message);
    const responseEncoder = encoding.createEncoder();

    // readSyncMessage dispatches on the message type:
    //   Step 1 (state vector): writes a step 2 response containing all updates
    //     the server has that the client's state vector does not reference.
    //     Only the missing delta is sent — not the whole document.
    //   Step 2 (update): applies the update to the authoritative Y.Doc so the
    //     server stays current and future joiners receive an up-to-date state.
    syncProtocol.readSyncMessage(decoder, responseEncoder, doc, null);

    // If readSyncMessage produced a response (always true for step 1, never
    // true for step 2), send it back to the client.
    if (encoding.length(responseEncoder) > 0) {
      client.emit('yjs:sync', {
        documentId: dto.documentId,
        message: encoding.toUint8Array(responseEncoder),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Live update relay (runs alongside the sync handshake)
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
    client.to(`document:${dto.documentId}`).emit('yjs:update', {
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
