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
import * as awarenessProtocol from 'y-protocols/awareness';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { JoinDocumentDto } from './dto/join-document.dto';
import { LeaveDocumentDto } from './dto/leave-document.dto';
import { YjsUpdateDto } from './dto/yjs-update.dto';
import { YjsSyncDto } from './dto/yjs-sync.dto';
import { AwarenessUpdateDto } from './dto/awareness-update.dto';
import { WsValidationFilter } from './filters/ws-exception.filter';

// CORS is configured on the IoAdapter in main.ts so it reads from typed config.
@WebSocketGateway()
@Injectable()
@UseFilters(new WsValidationFilter())
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class EditorGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  // Maps socketId → documentId → Set of Yjs awareness clientIds.
  // Used to identify which awareness states to remove on leave/disconnect.
  private readonly socketAwarenessIds = new Map<string, Map<string, Set<number>>>();

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
      // Remove and broadcast cursor/selection disappearance before the socket
      // leaves the room.  Cursors should disappear on disconnect immediately
      // so other clients do not see ghost cursors from absent users.
      this.removeAwarenessForSocket(client, documentId);

      client.to(`document:${documentId}`).emit('userLeft', {
        documentId,
        socketId: client.id,
      });
      this.documentManager.release(documentId);
    }

    this.socketAwarenessIds.delete(client.id);
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

    // Send current awareness states so the joining client immediately sees
    // where all other users' cursors and selections are.
    const awareness = this.documentManager.getAwareness(dto.documentId)!;
    const currentStates = awareness.getStates();
    if (currentStates.size > 0) {
      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(
        awareness,
        [...currentStates.keys()],
      );
      client.emit('awareness:update', {
        documentId: dto.documentId,
        update: awarenessUpdate,
      });
    }

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

    // Remove and broadcast cursor disappearance before leaving the room so
    // remaining clients receive the removal while the socket is still in-room.
    this.removeAwarenessForSocket(client, dto.documentId);

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

  // ---------------------------------------------------------------------------
  // Awareness — ephemeral presence (cursors / selections)
  // ---------------------------------------------------------------------------

  @SubscribeMessage('awareness:update')
  handleAwarenessUpdate(
    @MessageBody() dto: AwarenessUpdateDto,
    @ConnectedSocket() client: Socket,
  ): void {
    const update = toUint8Array(dto.update);
    if (update === null) {
      client.emit('error', { message: 'awareness:update — update must be binary data' });
      return;
    }

    const awareness = this.documentManager.getAwareness(dto.documentId);
    if (awareness === undefined) {
      client.emit('error', {
        message: `awareness:update — document ${dto.documentId} not in memory; send joinDocument first`,
      });
      return;
    }

    // Track which Yjs clientIds this socket is advertising for cleanup later.
    const clientIds = extractAwarenessClientIds(update);
    let docMap = this.socketAwarenessIds.get(client.id);
    if (docMap === undefined) {
      docMap = new Map();
      this.socketAwarenessIds.set(client.id, docMap);
    }
    const tracked = docMap.get(dto.documentId) ?? new Set<number>();
    for (const id of clientIds) tracked.add(id);
    docMap.set(dto.documentId, tracked);

    // Apply to the server's Awareness instance.
    // Awareness is ephemeral: cursor positions and selections are NOT persisted
    // to the database.  Only document text (via Yjs updates) is persisted.
    awarenessProtocol.applyAwarenessUpdate(awareness, update, client.id);

    // Relay to all other sockets in the room.
    // Echo suppression: the sender already applied the update locally.
    client.to(`document:${dto.documentId}`).emit('awareness:update', {
      documentId: dto.documentId,
      update,
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Removes the socket's awareness state for one document and broadcasts the
   * removal.  Cursors should disappear on disconnect/leave so other clients do
   * not see ghost cursors from users who are no longer present.
   */
  private removeAwarenessForSocket(client: Socket, documentId: string): void {
    const docMap = this.socketAwarenessIds.get(client.id);
    if (docMap === undefined) return;

    const clientIds = [...(docMap.get(documentId) ?? [])];
    docMap.delete(documentId);

    if (clientIds.length === 0) return;

    const awareness = this.documentManager.getAwareness(documentId);
    if (awareness === undefined) return;

    // Remove the states from the awareness instance (updates meta clocks).
    awarenessProtocol.removeAwarenessStates(awareness, clientIds, 'server-disconnect');

    // Encode a null-state update for the removed clientIds.  Passing an empty
    // Map causes encodeAwarenessUpdate to write null for each state entry
    // (Map.get returns undefined → undefined || null = null), which signals
    // to receiving clients that these cursors should be removed.
    const removalUpdate = awarenessProtocol.encodeAwarenessUpdate(
      awareness,
      clientIds,
      new Map<number, { [x: string]: unknown }>(),
    );

    client.to(`document:${documentId}`).emit('awareness:update', {
      documentId,
      update: removalUpdate,
    });
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value; // covers Buffer (Node.js subclass)
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

/**
 * Decodes the leading clientId entries from a y-protocols awareness update
 * without constructing a full Awareness object.  Used to track which Yjs
 * clientIds a socket is responsible for so they can be removed on disconnect.
 */
function extractAwarenessClientIds(update: Uint8Array): number[] {
  try {
    const decoder = decoding.createDecoder(update);
    const len = decoding.readVarUint(decoder);
    const ids: number[] = [];
    for (let i = 0; i < len; i++) {
      ids.push(decoding.readVarUint(decoder)); // clientId
      decoding.readVarUint(decoder);           // clock  (skip)
      decoding.readVarString(decoder);          // state  (skip)
    }
    return ids;
  } catch {
    return [];
  }
}
