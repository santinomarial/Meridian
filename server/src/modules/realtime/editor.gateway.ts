import { Injectable, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
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
import { RedisService } from '../../redis/redis.service';
import { ORIGIN_ID } from './origin';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { JoinDocumentDto } from './dto/join-document.dto';
import { LeaveDocumentDto } from './dto/leave-document.dto';
import { YjsUpdateDto } from './dto/yjs-update.dto';
import { YjsSyncDto } from './dto/yjs-sync.dto';
import { AwarenessUpdateDto } from './dto/awareness-update.dto';
import { WsValidationFilter } from './filters/ws-exception.filter';

// ---------------------------------------------------------------------------
// Cross-instance Redis message shapes
// ---------------------------------------------------------------------------

// Payload published to document:{documentId}:updates
interface CrossInstanceUpdate {
  originId: string;
  documentId: string;
  update: string; // base64-encoded Yjs update bytes
}

// Payload published to document:{documentId}:awareness
interface CrossInstanceAwareness {
  originId: string;
  documentId: string;
  update: string; // base64-encoded awareness update bytes
}

// CORS is configured on the IoAdapter in main.ts so it reads from typed config.
@WebSocketGateway()
@Injectable()
@UseFilters(new WsValidationFilter())
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class EditorGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server!: Server;

  // Maps socketId → documentId → Set of Yjs awareness clientIds.
  // Used to identify which awareness states to remove on leave/disconnect.
  private readonly socketAwarenessIds = new Map<string, Map<string, Set<number>>>();

  constructor(
    private readonly registry: ConnectionRegistryService,
    private readonly documentManager: DocumentManagerService,
    private readonly persistence: DocumentPersistenceService,
    private readonly redis: RedisService,
    @InjectPinoLogger(EditorGateway.name)
    private readonly logger: PinoLogger,
  ) {}

  // ---------------------------------------------------------------------------
  // Gateway init — Redis subscriptions
  // ---------------------------------------------------------------------------

  async afterInit(): Promise<void> {
    // Subscribe once to all document update and awareness channels using Redis
    // pattern subscriptions (PSUBSCRIBE).  A single pattern covers all
    // documents so there is no per-document subscribe/unsubscribe lifecycle.
    //
    // Local Socket.IO rooms only reach clients connected to this process.
    // Redis carries updates across backend instances so all instances converge
    // to the same Yjs document state and presence information regardless of
    // which instance a client is connected to.
    await Promise.all([
      this.redis.subscribe('document:*:updates', (channel, msg) =>
        this.onRedisUpdate(channel, msg as string),
      ),
      this.redis.subscribe('document:*:awareness', (channel, msg) =>
        this.onRedisAwareness(channel, msg as string),
      ),
    ]);

    if (this.redis.isAvailable) {
      this.logger.info(
        { originId: ORIGIN_ID },
        'EditorGateway subscribed to Redis cross-instance channels',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Socket lifecycle
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
      //
      // removeAwarenessForSocket also publishes the removal to Redis so
      // cursors disappear on all backend instances, not just this one.
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

    // Acquire the authoritative Y.Doc.  On first join, this loads the latest
    // snapshot and any subsequent delta updates from the database so the
    // server's in-memory doc is authoritative before the sync handshake begins.
    const doc = await this.documentManager.acquire(dto.documentId);

    // Sync step 1: send the server's state vector to the joining client.
    //
    // A state vector is a compact summary of which updates a replica already
    // has (clock per client-id). The client uses it to compute only the
    // updates the server is missing and sends them back as sync step 2.
    // This avoids resending the whole document to late joiners — only the
    // delta (what the client has that the server doesn't) travels over the
    // wire, and the server sends its own delta back.
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
    // Also publishes the removal to Redis for cross-instance cleanup.
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

    // Relay the raw update to every OTHER socket in the local document room.
    //
    // Echo suppression: the sending client has already applied this update
    // to its own local Y.Doc. Re-sending it back would cause the client to
    // apply the same update twice, leading to duplicated content or spurious
    // state-vector growth. Other clients still receive the update and merge
    // it into their own docs via Y.applyUpdate.
    //
    // Local Socket.IO rooms only reach clients connected to this process.
    // Redis (below) carries the update to sibling backend instances.
    client.to(`document:${dto.documentId}`).emit('yjs:update', {
      documentId: dto.documentId,
      update,
    });

    // Persist asynchronously — relay already happened above so peers are not
    // blocked by the database write.  Postgres remains the durable source of
    // truth; Redis is ephemeral and carries only the live-editing stream.
    this.persistence.persistUpdate(dto.documentId, update);

    // Publish to Redis so every sibling instance applies the update to its
    // in-memory Y.Doc and relays it to its local sockets.  Fire-and-forget:
    // if Redis is unavailable the void discards the no-op Promise silently.
    void this.publishYjsUpdate(dto.documentId, update);

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

    // Relay to all other LOCAL sockets in the room.
    // Echo suppression: the sender already applied the update locally.
    // Redis (below) carries the update to sibling backend instances.
    client.to(`document:${dto.documentId}`).emit('awareness:update', {
      documentId: dto.documentId,
      update,
    });

    // Cross-instance awareness propagation.  Awareness is eventually consistent
    // across the cluster: each instance maintains its own Awareness object and
    // receives remote states via Redis.  Exact cluster-wide presence converges
    // within one round-trip once all sockets have advertised their state.
    void this.publishAwareness(dto.documentId, update);
  }

  // ---------------------------------------------------------------------------
  // Redis — inbound handlers
  // ---------------------------------------------------------------------------

  private onRedisUpdate(channel: string, message: string): void {
    let payload: CrossInstanceUpdate;
    try {
      payload = JSON.parse(message) as CrossInstanceUpdate;
    } catch {
      this.logger.warn({ channel }, 'Received malformed Redis update message');
      return;
    }

    // originId prevents double-apply and self-echo: the originating instance
    // already applied the update locally and relayed it to its own sockets.
    if (payload.originId === ORIGIN_ID) return;

    // Only apply if the document is active on this instance.  Documents not in
    // memory will be rebuilt from Postgres on next cold start — including all
    // updates persisted by the originating instance.  Applying an update to a
    // document that isn't loaded would create a dangling in-memory state.
    if (!this.documentManager.hasDocument(payload.documentId)) return;

    try {
      const update = Buffer.from(payload.update, 'base64');
      this.documentManager.applyUpdate(payload.documentId, update);

      // Relay to all local sockets in this document's room.
      this.server.to(`document:${payload.documentId}`).emit('yjs:update', {
        documentId: payload.documentId,
        update,
      });
    } catch (err) {
      this.logger.error(
        { err, documentId: payload.documentId },
        'Failed to apply cross-instance Yjs update',
      );
    }
  }

  private onRedisAwareness(channel: string, message: string): void {
    let payload: CrossInstanceAwareness;
    try {
      payload = JSON.parse(message) as CrossInstanceAwareness;
    } catch {
      this.logger.warn({ channel }, 'Received malformed Redis awareness message');
      return;
    }

    // Ignore own messages — this instance already applied the update locally.
    if (payload.originId === ORIGIN_ID) return;

    // Local socket registry is per-instance.  If this instance has no sockets
    // for this document, there is nothing to relay.  Awareness is ephemeral —
    // it is not persisted and will re-converge when clients reconnect.
    if (!this.documentManager.hasDocument(payload.documentId)) return;

    const awareness = this.documentManager.getAwareness(payload.documentId);
    if (awareness === undefined) return;

    try {
      const update = Buffer.from(payload.update, 'base64');

      // 'redis-remote' is the origin tag — distinct from any socket.id so
      // awareness state tracking does not confuse remote clients with local ones.
      awarenessProtocol.applyAwarenessUpdate(awareness, update, 'redis-remote');

      this.server.to(`document:${payload.documentId}`).emit('awareness:update', {
        documentId: payload.documentId,
        update,
      });
    } catch (err) {
      this.logger.error(
        { err, documentId: payload.documentId },
        'Failed to apply cross-instance awareness update',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Redis — outbound helpers
  // ---------------------------------------------------------------------------

  private async publishYjsUpdate(
    documentId: string,
    update: Uint8Array,
  ): Promise<void> {
    const payload: CrossInstanceUpdate = {
      originId: ORIGIN_ID,
      documentId,
      update: Buffer.from(update).toString('base64'),
    };
    await this.redis.publish(
      `document:${documentId}:updates`,
      JSON.stringify(payload),
    );
  }

  private async publishAwareness(
    documentId: string,
    update: Uint8Array,
  ): Promise<void> {
    const payload: CrossInstanceAwareness = {
      originId: ORIGIN_ID,
      documentId,
      update: Buffer.from(update).toString('base64'),
    };
    await this.redis.publish(
      `document:${documentId}:awareness`,
      JSON.stringify(payload),
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Removes the socket's awareness state for one document and broadcasts the
   * removal both to local sockets and to Redis.
   *
   * Cursors should disappear on disconnect/leave so other clients — on this
   * instance and on sibling instances — do not see ghost cursors from users
   * who are no longer present.
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

    // Relay to local sockets still in the room.
    client.to(`document:${documentId}`).emit('awareness:update', {
      documentId,
      update: removalUpdate,
    });

    // Publish removal to Redis so ghost cursors disappear on sibling instances.
    // Awareness is ephemeral — this removal is NOT persisted to Postgres.
    void this.publishAwareness(documentId, removalUpdate);
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
