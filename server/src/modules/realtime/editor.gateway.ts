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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Server, Socket } from 'socket.io';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { toAuthUser } from '../auth/auth.service';
import { ORIGIN_ID } from './origin';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { DocumentRestoreService } from './document-restore.service';
import { WsRateLimiter } from './ws-rate-limiter.service';
import { JoinDocumentDto } from './dto/join-document.dto';
import { JoinWorkspaceDto } from './dto/join-workspace.dto';
import { ChatMessageDto } from './dto/chat-message.dto';
import { LeaveDocumentDto } from './dto/leave-document.dto';
import { YjsUpdateDto } from './dto/yjs-update.dto';
import { YjsSyncDto } from './dto/yjs-sync.dto';
import { AwarenessUpdateDto } from './dto/awareness-update.dto';
import { WsValidationFilter } from './filters/ws-exception.filter';
import type { AuthUser, JwtPayload } from '../auth/types/auth-user.type';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

// ---------------------------------------------------------------------------
// Cross-instance Redis message shapes
// ---------------------------------------------------------------------------

interface CrossInstanceUpdate {
  originId: string;
  documentId: string;
  update: string; // base64-encoded Yjs update bytes
}

interface CrossInstanceAwareness {
  originId: string;
  documentId: string;
  update: string; // base64-encoded awareness update bytes
}

interface CrossInstanceChat {
  originId: string;
  workspaceId: string;
  message: ChatMessagePayload;
}

export interface ChatMessagePayload {
  id: string;
  workspaceId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
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
  private readonly socketAwarenessIds = new Map<string, Map<string, Set<number>>>();

  // Cached at construction time to avoid per-message config lookups.
  private readonly wsMessageLimit: number;
  private readonly wsMaxUpdateBytes: number;

  constructor(
    private readonly registry: ConnectionRegistryService,
    private readonly documentManager: DocumentManagerService,
    private readonly persistence: DocumentPersistenceService,
    private readonly documentRestore: DocumentRestoreService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly rateLimiter: WsRateLimiter,
    configService: ConfigService,
    @InjectPinoLogger(EditorGateway.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    // Mirror the HTTP throttler: E2E suites drive the editor far faster than
    // a human and must never have CRDT updates dropped by the rate limiter.
    const isE2E = process.env['E2E_TEST'] === 'true';
    this.wsMessageLimit = isE2E ? 100_000 : config.wsMessageLimitPerSecond;
    this.wsMaxUpdateBytes = config.wsMaxYjsUpdateBytes;
  }

  // ---------------------------------------------------------------------------
  // Gateway init — auth middleware + Redis subscriptions
  // ---------------------------------------------------------------------------

  async afterInit(): Promise<void> {
    // Give the restore service the Socket.IO server so HTTP version restores
    // can broadcast the resulting Yjs update and the document:restored event.
    this.documentRestore.registerServer(this.server);

    // Authenticate every socket before it connects.  The middleware runs
    // synchronously as part of the Socket.IO handshake; calling next(error)
    // rejects the connection before handleConnection is ever invoked.
    this.server.use(async (socket, next) => {
      try {
        await this.authenticateSocket(socket);
        next();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Authentication failed';
        next(new Error(message));
      }
    });

    await Promise.all([
      this.redis.subscribe('document:*:updates', (channel, msg) =>
        this.onRedisUpdate(channel, msg as string),
      ),
      this.redis.subscribe('document:*:awareness', (channel, msg) =>
        this.onRedisAwareness(channel, msg as string),
      ),
      this.redis.subscribe('workspace:*:chat', (channel, msg) =>
        this.onRedisChat(channel, msg as string),
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

    // socket.data.user is guaranteed here — the middleware in afterInit()
    // rejects unauthenticated sockets before handleConnection fires.
    const user = client.data['user'] as AuthUser;
    this.registry.register(client.id, user.id);

    this.logger.info(
      { socketId: client.id, requestId: requestIdStr, userId: user.id },
      'Socket connected',
    );
  }

  handleDisconnect(client: Socket): void {
    const documentIds = this.registry.getDocumentsForSocket(client.id);

    for (const documentId of documentIds) {
      this.removeAwarenessForSocket(client, documentId);

      client.to(`document:${documentId}`).emit('userLeft', {
        documentId,
        socketId: client.id,
      });
      this.documentManager.release(documentId);
    }

    this.socketAwarenessIds.delete(client.id);
    this.registry.disconnect(client.id);
    // Release the per-socket rate-limit window to avoid memory leaks.
    this.rateLimiter.clear(client.id);

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
    if (!this.checkRateLimit(client, 'joinDocument')) return;

    const user = client.data['user'] as AuthUser;
    const room = `document:${dto.documentId}`;

    // Socket.IO room membership and DocumentManager reference counts must stay
    // one-to-one. A duplicate join from the same socket used to increment the
    // document ref-count twice while disconnect released it only once.
    if (client.rooms.has(room)) {
      client.emit('joinedDocument', {
        documentId: dto.documentId,
        socketId: client.id,
      });
      return;
    }

    // Authorization: the user must be a workspace member.  getDocumentAccessInfo
    // returns the role in the same query so we can cache it for yjs:update checks.
    const accessInfo = await this.workspaces.getDocumentAccessInfo(
      user.id,
      dto.documentId,
    );
    if (!accessInfo) {
      client.emit('error', {
        message: `Access denied to document ${dto.documentId}`,
      });
      this.logger.warn(
        { socketId: client.id, userId: user.id, documentId: dto.documentId },
        'Unauthorized joinDocument attempt',
      );
      return;
    }

    // Cache the role so handleYjsUpdate can reject viewer writes without a DB hit.
    const docRoles =
      (client.data['documentRoles'] as Record<string, WorkspaceRole> | undefined) ?? {};
    docRoles[dto.documentId] = accessInfo.role;
    client.data['documentRoles'] = docRoles;

    await client.join(room);
    this.registry.join(client.id, dto.documentId);

    let doc: import('yjs').Doc;
    try {
      doc = await this.documentManager.acquire(dto.documentId);
    } catch (err) {
      // Roll back the room join so the socket isn't left in a broken state.
      await client.leave(room);
      this.registry.leave(client.id, dto.documentId);
      delete docRoles[dto.documentId];
      client.emit('error', {
        message: `Failed to load document ${dto.documentId}`,
      });
      this.logger.error(
        { err, socketId: client.id, documentId: dto.documentId },
        'Failed to acquire document — join aborted',
      );
      return;
    }

    const step1Encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(step1Encoder, doc);
    client.emit('yjs:sync', {
      documentId: dto.documentId,
      message: encoding.toUint8Array(step1Encoder),
    });

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

    client.to(room).emit('userJoined', {
      documentId: dto.documentId,
      socketId: client.id,
      userId: user.id,
      displayName: user.displayName,
    });

    client.emit('joinedDocument', {
      documentId: dto.documentId,
      socketId: client.id,
    });

    this.logger.info(
      { socketId: client.id, documentId: dto.documentId, userId: user.id },
      'Socket joined document',
    );
  }

  @SubscribeMessage('leaveDocument')
  async handleLeaveDocument(
    @MessageBody() dto: LeaveDocumentDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const room = `document:${dto.documentId}`;

    // Ignore forged/duplicate leave events. Releasing a globally loaded
    // document that this socket never acquired corrupts its reference count.
    if (!client.rooms.has(room)) return;

    this.removeAwarenessForSocket(client, dto.documentId);

    // Clean up cached role for this document.
    const docRoles = client.data['documentRoles'] as Record<string, WorkspaceRole> | undefined;
    if (docRoles !== undefined) delete docRoles[dto.documentId];

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
  // Workspace rooms — presence-wide events such as chat
  // ---------------------------------------------------------------------------

  @SubscribeMessage('joinWorkspace')
  async handleJoinWorkspace(
    @MessageBody() dto: JoinWorkspaceDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.checkRateLimit(client, 'joinWorkspace')) return;

    const user = client.data['user'] as AuthUser;
    const authorized = await this.workspaces.canUserAccessWorkspace(
      user.id,
      dto.workspaceId,
    );
    if (!authorized) {
      client.emit('error', {
        message: `Access denied to workspace ${dto.workspaceId}`,
      });
      this.logger.warn(
        { socketId: client.id, userId: user.id, workspaceId: dto.workspaceId },
        'Unauthorized joinWorkspace attempt',
      );
      return;
    }

    await client.join(`workspace:${dto.workspaceId}`);
    client.emit('joinedWorkspace', { workspaceId: dto.workspaceId });

    this.logger.info(
      { socketId: client.id, workspaceId: dto.workspaceId, userId: user.id },
      'Socket joined workspace room',
    );
  }

  @SubscribeMessage('chat:message')
  handleChatMessage(
    @MessageBody() dto: ChatMessageDto,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!this.checkRateLimit(client, 'chat:message')) return;

    const room = `workspace:${dto.workspaceId}`;
    // Room membership doubles as the authorization check — joinWorkspace
    // already verified the user belongs to this workspace.
    if (!client.rooms.has(room)) {
      client.emit('error', {
        message: 'chat:message — send joinWorkspace first',
      });
      return;
    }

    const user = client.data['user'] as AuthUser;
    const message: ChatMessagePayload = {
      id: `msg-${Date.now()}-${client.id.slice(0, 6)}`,
      workspaceId: dto.workspaceId,
      senderId: user.id,
      senderName: user.displayName,
      text: dto.text,
      timestamp: Date.now(),
    };

    client.to(room).emit('chat:message', message);
    void this.publishChat(dto.workspaceId, message);

    this.logger.debug(
      { socketId: client.id, workspaceId: dto.workspaceId },
      'Chat message relayed',
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
    if (!this.checkRateLimit(client, 'yjs:sync')) return;

    // A document being loaded by some other socket is not authorization. Every
    // document event must be scoped to a room this socket successfully joined.
    const role = this.joinedDocumentRole(client, dto.documentId);
    if (role === null) {
      client.emit('error', {
        message: 'yjs:sync — send joinDocument and wait for joinedDocument first',
      });
      return;
    }

    const message = toUint8Array(dto.message);
    if (message === null) {
      client.emit('error', { message: 'yjs:sync — message must be binary data' });
      return;
    }

    if (message.byteLength > this.wsMaxUpdateBytes) {
      client.emit('error', {
        message: `Payload too large: ${message.byteLength} bytes (limit ${this.wsMaxUpdateBytes})`,
      });
      return;
    }

    let messageType: number;
    try {
      messageType = decoding.readVarUint(decoding.createDecoder(message));
    } catch {
      client.emit('error', { message: 'yjs:sync — malformed sync message' });
      return;
    }

    // This endpoint is deliberately read-only on the server. The client sends
    // SyncStep1 to request the server's missing state; all actual mutations must
    // use yjs:update, which enforces write roles, broadcasts, and persists.
    // SyncStep2 is the protocol's automatic response to the server's opening
    // Step1, so it is safe to ignore silently. Applying it here used to provide
    // an unpersisted write path (including for viewers).
    if (messageType === syncProtocol.messageYjsSyncStep2) return;
    if (messageType !== syncProtocol.messageYjsSyncStep1) {
      client.emit('error', {
        message: 'yjs:sync — mutating sync messages are not accepted; use yjs:update',
      });
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

    try {
      syncProtocol.readSyncMessage(decoder, responseEncoder, doc, null);
    } catch {
      client.emit('error', { message: 'yjs:sync — malformed sync message' });
      return;
    }

    if (encoding.length(responseEncoder) > 0) {
      client.emit('yjs:sync', {
        documentId: dto.documentId,
        message: encoding.toUint8Array(responseEncoder),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Live update relay
  // ---------------------------------------------------------------------------

  @SubscribeMessage('yjs:update')
  handleYjsUpdate(
    @MessageBody() dto: YjsUpdateDto,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!this.checkRateLimit(client, 'yjs:update')) return;

    const user = client.data['user'] as AuthUser;

    // A cached role without room membership (or room membership without a
    // cached role) is never sufficient. This prevents an authenticated socket
    // from editing any document that merely happens to be loaded in this
    // process by another user.
    const role = this.joinedDocumentRole(client, dto.documentId);
    if (role === null) {
      client.emit('error', {
        message: 'yjs:update — send joinDocument and wait for joinedDocument first',
      });
      return;
    }

    // Viewers may receive updates but must not persist or relay edits.
    if (role === WorkspaceRole.VIEWER) {
      this.logger.warn(
        { socketId: client.id, userId: user.id, documentId: dto.documentId },
        'Viewer yjs:update rejected',
      );
      client.emit('error', { message: 'Viewers cannot send document updates' });
      return;
    }

    const update = toUint8Array(dto.update);

    if (update === null) {
      client.emit('error', { message: 'yjs:update — update must be binary data' });
      return;
    }

    // Payload cap — reject oversized updates before any processing.
    if (update.byteLength > this.wsMaxUpdateBytes) {
      this.logger.warn(
        {
          socketId: client.id,
          documentId: dto.documentId,
          bytes: update.byteLength,
          limit: this.wsMaxUpdateBytes,
        },
        'Oversized Yjs update rejected',
      );
      client.emit('error', {
        message: `Payload too large: ${update.byteLength} bytes (limit ${this.wsMaxUpdateBytes})`,
      });
      return;
    }

    if (!this.documentManager.hasDocument(dto.documentId)) {
      client.emit('error', {
        message: `yjs:update — document ${dto.documentId} not in memory; send joinDocument first`,
      });
      return;
    }

    this.documentManager.applyUpdate(dto.documentId, update);

    client.to(`document:${dto.documentId}`).emit('yjs:update', {
      documentId: dto.documentId,
      update,
    });

    this.persistence.persistUpdate(dto.documentId, update);

    void this.publishYjsUpdate(dto.documentId, update);

    this.logger.debug(
      { socketId: client.id, documentId: dto.documentId, bytes: update.byteLength },
      'Yjs update relayed',
    );
  }

  // ---------------------------------------------------------------------------
  // Awareness
  // ---------------------------------------------------------------------------

  @SubscribeMessage('awareness:update')
  handleAwarenessUpdate(
    @MessageBody() dto: AwarenessUpdateDto,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!this.checkRateLimit(client, 'awareness:update')) return;

    if (this.joinedDocumentRole(client, dto.documentId) === null) {
      client.emit('error', {
        message: 'awareness:update — send joinDocument and wait for joinedDocument first',
      });
      return;
    }

    const update = toUint8Array(dto.update);
    if (update === null) {
      client.emit('error', { message: 'awareness:update — update must be binary data' });
      return;
    }

    if (update.byteLength > this.wsMaxUpdateBytes) {
      client.emit('error', {
        message: `Payload too large: ${update.byteLength} bytes (limit ${this.wsMaxUpdateBytes})`,
      });
      return;
    }

    const awareness = this.documentManager.getAwareness(dto.documentId);
    if (awareness === undefined) {
      client.emit('error', {
        message: `awareness:update — document ${dto.documentId} not in memory; send joinDocument first`,
      });
      return;
    }

    const clientIds = extractAwarenessClientIds(update);
    let docMap = this.socketAwarenessIds.get(client.id);
    if (docMap === undefined) {
      docMap = new Map();
      this.socketAwarenessIds.set(client.id, docMap);
    }
    const tracked = docMap.get(dto.documentId) ?? new Set<number>();
    for (const id of clientIds) tracked.add(id);
    docMap.set(dto.documentId, tracked);

    awarenessProtocol.applyAwarenessUpdate(awareness, update, client.id);

    client.to(`document:${dto.documentId}`).emit('awareness:update', {
      documentId: dto.documentId,
      update,
    });

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

    if (payload.originId === ORIGIN_ID) return;
    if (!this.documentManager.hasDocument(payload.documentId)) return;

    try {
      const update = Buffer.from(payload.update, 'base64');
      this.documentManager.applyUpdate(payload.documentId, update);

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

    if (payload.originId === ORIGIN_ID) return;
    if (!this.documentManager.hasDocument(payload.documentId)) return;

    const awareness = this.documentManager.getAwareness(payload.documentId);
    if (awareness === undefined) return;

    try {
      const update = Buffer.from(payload.update, 'base64');
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

  private onRedisChat(channel: string, message: string): void {
    let payload: CrossInstanceChat;
    try {
      payload = JSON.parse(message) as CrossInstanceChat;
    } catch {
      this.logger.warn({ channel }, 'Received malformed Redis chat message');
      return;
    }

    if (payload.originId === ORIGIN_ID) return;

    this.server
      .to(`workspace:${payload.workspaceId}`)
      .emit('chat:message', payload.message);
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

  private async publishChat(
    workspaceId: string,
    message: ChatMessagePayload,
  ): Promise<void> {
    const payload: CrossInstanceChat = {
      originId: ORIGIN_ID,
      workspaceId,
      message,
    };
    await this.redis.publish(
      `workspace:${workspaceId}:chat`,
      JSON.stringify(payload),
    );
  }

  // ---------------------------------------------------------------------------
  // Socket authentication
  // ---------------------------------------------------------------------------

  async authenticateSocket(socket: Socket): Promise<void> {
    const token = extractSocketToken(socket);
    if (token === null) {
      throw new Error('No authentication token');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new Error('Invalid or expired token');
    }

    const session = await this.prisma.session.findUnique({
      where: { jti: payload.jti },
      include: { user: true },
    });

    if (session === null) {
      throw new Error('Session not found');
    }
    if (session.expiresAt < new Date()) {
      throw new Error('Session expired');
    }
    if (session.revokedAt !== null) {
      throw new Error('Session revoked');
    }

    socket.data['user'] = toAuthUser(session.user);
  }

  // ---------------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------------

  /**
   * Checks the per-socket message rate limit.
   * Emits an error to the socket and returns false when the limit is exceeded
   * so callers can immediately return without processing the message.
   */
  private checkRateLimit(client: Socket, event: string): boolean {
    if (this.rateLimiter.check(client.id, this.wsMessageLimit)) return true;

    this.logger.warn(
      { socketId: client.id, event, limit: this.wsMessageLimit },
      'WebSocket rate limit exceeded — message dropped',
    );
    client.emit('error', {
      message: `Rate limit exceeded: max ${this.wsMessageLimit} messages/s`,
    });
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private removeAwarenessForSocket(client: Socket, documentId: string): void {
    const docMap = this.socketAwarenessIds.get(client.id);
    if (docMap === undefined) return;

    const clientIds = [...(docMap.get(documentId) ?? [])];
    docMap.delete(documentId);

    if (clientIds.length === 0) return;

    const awareness = this.documentManager.getAwareness(documentId);
    if (awareness === undefined) return;

    awarenessProtocol.removeAwarenessStates(awareness, clientIds, 'server-disconnect');

    const removalUpdate = awarenessProtocol.encodeAwarenessUpdate(
      awareness,
      clientIds,
      new Map<number, { [x: string]: unknown }>(),
    );

    client.to(`document:${documentId}`).emit('awareness:update', {
      documentId,
      update: removalUpdate,
    });

    void this.publishAwareness(documentId, removalUpdate);
  }

  /** Returns the cached role only when this exact socket joined the document. */
  private joinedDocumentRole(
    client: Socket,
    documentId: string,
  ): WorkspaceRole | null {
    if (!client.rooms.has(`document:${documentId}`)) return null;
    const roles = client.data['documentRoles'] as
      | Record<string, WorkspaceRole>
      | undefined;
    return roles?.[documentId] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function extractAwarenessClientIds(update: Uint8Array): number[] {
  try {
    const decoder = decoding.createDecoder(update);
    const len = decoding.readVarUint(decoder);
    const ids: number[] = [];
    for (let i = 0; i < len; i++) {
      ids.push(decoding.readVarUint(decoder));
      decoding.readVarUint(decoder);
      decoding.readVarString(decoder);
    }
    return ids;
  } catch {
    return [];
  }
}

export function extractSocketToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as Record<string, unknown>;
  const authToken = auth['token'];
  if (typeof authToken === 'string' && authToken.length > 0) return authToken;

  const cookieHeader = socket.handshake.headers['cookie'];
  if (typeof cookieHeader === 'string') {
    const match = /auth_token=([^;]+)/.exec(cookieHeader);
    if (match?.[1] !== undefined) return decodeURIComponent(match[1]);
  }

  return null;
}
