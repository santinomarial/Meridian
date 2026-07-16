import {
  Injectable,
  OnModuleDestroy,
  UseFilters,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
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
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { toAuthUser } from '../auth/auth.service';
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
import {
  RealtimeAuthorizationService,
  SOCKET_SESSION_JTI,
  type RealtimeAuthorizationInvalidation,
} from '../realtime-authorization/realtime-authorization.service';

const AUTHORIZATION_SWEEP_MS = 10_000;
const AUTHORIZATION_EVENT_CACHE_MS = 1_000;

// ---------------------------------------------------------------------------
// Cross-instance Redis message shapes
// ---------------------------------------------------------------------------

interface CrossInstanceUpdate {
  originId: string;
  documentId: string;
  // CRDT generation the update belongs to — receivers drop updates for a
  // lineage they are not (or no longer) serving.
  generation: number;
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
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  // Maps socketId → documentId → Set of Yjs awareness clientIds.
  private readonly socketAwarenessIds = new Map<string, Map<string, Set<number>>>();

  // Cached at construction time to avoid per-message config lookups.
  private readonly wsMessageLimit: number;
  private readonly wsMaxUpdateBytes: number;
  private readonly connectedClients = new Map<string, Socket>();
  private readonly unsubscribeAuthorization: () => void;
  private authorizationSweep: NodeJS.Timeout | undefined;
  private authorizationSweepRunning = false;

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
    private readonly realtimeAuthorization: RealtimeAuthorizationService,
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
    this.unsubscribeAuthorization = this.realtimeAuthorization.onInvalidation(
      (invalidation) => this.handleAuthorizationInvalidation(invalidation),
    );
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

    this.authorizationSweep = setInterval(() => {
      void this.auditConnectedClients();
    }, AUTHORIZATION_SWEEP_MS);
    this.authorizationSweep.unref();
  }

  onModuleDestroy(): void {
    if (this.authorizationSweep !== undefined) {
      clearInterval(this.authorizationSweep);
      this.authorizationSweep = undefined;
    }
    this.unsubscribeAuthorization();
    this.connectedClients.clear();
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
    this.connectedClients.set(client.id, client);

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
    this.connectedClients.delete(client.id);
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

    const accessInfo = await this.authorizeDocumentEvent(
      client,
      dto.documentId,
      'joinDocument',
    );
    if (accessInfo === null) return;

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

    // Cache current access metadata for passive-room reauthorization sweeps.
    // Sensitive events still query the database and never trust this cache.
    const docRoles =
      (client.data['documentRoles'] as Record<string, WorkspaceRole> | undefined) ?? {};
    docRoles[dto.documentId] = accessInfo.role;
    client.data['documentRoles'] = docRoles;
    const docWorkspaces =
      (client.data['documentWorkspaces'] as Record<string, string> | undefined) ?? {};
    docWorkspaces[dto.documentId] = accessInfo.workspaceId;
    client.data['documentWorkspaces'] = docWorkspaces;

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
      delete docWorkspaces[dto.documentId];
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
    const docWorkspaces = client.data['documentWorkspaces'] as
      | Record<string, string>
      | undefined;
    if (docWorkspaces !== undefined) delete docWorkspaces[dto.documentId];

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
    const role = await this.authorizeWorkspaceEvent(
      client,
      dto.workspaceId,
      'joinWorkspace',
    );
    if (role === null) return;

    await client.join(`workspace:${dto.workspaceId}`);
    this.cacheWorkspaceRole(client, dto.workspaceId, role);
    client.emit('joinedWorkspace', { workspaceId: dto.workspaceId });

    this.logger.info(
      { socketId: client.id, workspaceId: dto.workspaceId, userId: user.id },
      'Socket joined workspace room',
    );
  }

  @SubscribeMessage('chat:message')
  async handleChatMessage(
    @MessageBody() dto: ChatMessageDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.checkRateLimit(client, 'chat:message')) return;

    const room = `workspace:${dto.workspaceId}`;
    if (!client.rooms.has(room)) {
      client.emit('error', {
        message: 'chat:message — send joinWorkspace first',
      });
      return;
    }

    const role = await this.authorizeWorkspaceEvent(
      client,
      dto.workspaceId,
      'chat:message',
    );
    if (role === null) return;
    this.cacheWorkspaceRole(client, dto.workspaceId, role);

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
  async handleYjsSync(
    @MessageBody() dto: YjsSyncDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.checkRateLimit(client, 'yjs:sync')) return;

    // A document being loaded by some other socket is not authorization. Every
    // document event must be scoped to a room this socket successfully joined.
    if (this.joinedDocumentRole(client, dto.documentId) === null) {
      client.emit('error', {
        message: 'yjs:sync — send joinDocument and wait for joinedDocument first',
      });
      return;
    }

    const accessInfo = await this.authorizeDocumentEvent(
      client,
      dto.documentId,
      'yjs:sync',
    );
    if (accessInfo === null) return;

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
  async handleYjsUpdate(
    @MessageBody() dto: YjsUpdateDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.checkRateLimit(client, 'yjs:update')) return;

    const user = client.data['user'] as AuthUser;

    // A cached role without room membership (or room membership without a
    // cached role) is never sufficient. This prevents an authenticated socket
    // from editing any document that merely happens to be loaded in this
    // process by another user.
    if (this.joinedDocumentRole(client, dto.documentId) === null) {
      client.emit('error', {
        message: 'yjs:update — send joinDocument and wait for joinedDocument first',
      });
      return;
    }


    const accessInfo = await this.authorizeDocumentEvent(
      client,
      dto.documentId,
      'yjs:update',
    );
    if (accessInfo === null) return;
    const role = accessInfo.role;

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
  async handleAwarenessUpdate(
    @MessageBody() dto: AwarenessUpdateDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.checkRateLimit(client, 'awareness:update')) return;

    if (this.joinedDocumentRole(client, dto.documentId) === null) {
      client.emit('error', {
        message: 'awareness:update — send joinDocument and wait for joinedDocument first',
      });
      return;
    }

    const accessInfo = await this.authorizeDocumentEvent(
      client,
      dto.documentId,
      'awareness:update',
    );
    if (accessInfo === null) return;

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
    if (session.userId !== payload.sub) {
      throw new Error('Session user mismatch');
    }
    if (session.expiresAt < new Date()) {
      throw new Error('Session expired');
    }
    if (session.revokedAt !== null) {
      throw new Error('Session revoked');
    }

    socket.data['user'] = toAuthUser(session.user);
    socket.data[SOCKET_SESSION_JTI] = payload.jti;
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

  private async authorizeDocumentEvent(
    client: Socket,
    documentId: string,
    event: string,
  ): Promise<{ workspaceId: string; role: WorkspaceRole } | null> {
    const user = client.data['user'] as AuthUser | undefined;
    const cachedRoles = client.data['documentRoles'] as
      | Record<string, WorkspaceRole>
      | undefined;
    const cachedWorkspaces = client.data['documentWorkspaces'] as
      | Record<string, string>
      | undefined;
    const checkedAt = client.data['documentAuthorizationCheckedAt'] as
      | Record<string, number>
      | undefined;
    const useCachedAccess =
      cachedRoles?.[documentId] !== undefined &&
      cachedWorkspaces?.[documentId] !== undefined &&
      checkedAt?.[documentId] !== undefined &&
      Date.now() - checkedAt[documentId] < AUTHORIZATION_EVENT_CACHE_MS;
    const accessPromise = useCachedAccess
      ? Promise.resolve({
          workspaceId: cachedWorkspaces[documentId]!,
          role: cachedRoles[documentId]!,
        })
      : user === undefined
        ? Promise.resolve(null)
        : this.workspaces.getDocumentAccessInfo(user.id, documentId);
    const [sessionActive, accessInfo] = await Promise.all([
      this.realtimeAuthorization.isSessionActive(client),
      accessPromise,
    ]);

    if (!sessionActive || user === undefined) {
      this.disconnectForInvalidSession(client, event);
      return null;
    }

    if (accessInfo === null) {
      if (client.rooms.has(`document:${documentId}`)) {
        await this.revokeDocumentAccess(client, documentId);
      }
      client.emit('error', { message: `Access denied to document ${documentId}` });
      this.logger.warn(
        { socketId: client.id, userId: user.id, documentId, event },
        'Realtime document access rejected after reauthorization',
      );
      return null;
    }

    const roles =
      (client.data['documentRoles'] as Record<string, WorkspaceRole> | undefined) ?? {};
    roles[documentId] = accessInfo.role;
    client.data['documentRoles'] = roles;

    const workspaces =
      (client.data['documentWorkspaces'] as Record<string, string> | undefined) ?? {};
    workspaces[documentId] = accessInfo.workspaceId;
    client.data['documentWorkspaces'] = workspaces;
    const accessTimes = checkedAt ?? {};
    accessTimes[documentId] = Date.now();
    client.data['documentAuthorizationCheckedAt'] = accessTimes;

    return accessInfo;
  }

  private async authorizeWorkspaceEvent(
    client: Socket,
    workspaceId: string,
    event: string,
  ): Promise<WorkspaceRole | null> {
    const user = client.data['user'] as AuthUser | undefined;
    const cachedRoles = client.data['workspaceRoles'] as
      | Record<string, WorkspaceRole>
      | undefined;
    const checkedAt = client.data['workspaceAuthorizationCheckedAt'] as
      | Record<string, number>
      | undefined;
    const useCachedRole =
      cachedRoles?.[workspaceId] !== undefined &&
      checkedAt?.[workspaceId] !== undefined &&
      Date.now() - checkedAt[workspaceId] < AUTHORIZATION_EVENT_CACHE_MS;
    const rolePromise = useCachedRole
      ? Promise.resolve(cachedRoles[workspaceId]!)
      : user === undefined
        ? Promise.resolve(null)
        : this.workspaces.getMemberRole(user.id, workspaceId);
    const [sessionActive, role] = await Promise.all([
      this.realtimeAuthorization.isSessionActive(client),
      rolePromise,
    ]);

    if (!sessionActive || user === undefined) {
      this.disconnectForInvalidSession(client, event);
      return null;
    }
    if (role === null) {
      await this.revokeWorkspaceAccess(client, workspaceId);
      client.emit('error', { message: `Access denied to workspace ${workspaceId}` });
      this.logger.warn(
        { socketId: client.id, userId: user.id, workspaceId, event },
        'Realtime workspace access rejected after reauthorization',
      );
      return null;
    }
    const accessTimes = checkedAt ?? {};
    accessTimes[workspaceId] = Date.now();
    client.data['workspaceAuthorizationCheckedAt'] = accessTimes;
    return role;
  }

  private disconnectForInvalidSession(client: Socket, event: string): void {
    this.logger.warn(
      { socketId: client.id, event },
      'Socket disconnected after session reauthorization failed',
    );
    client.emit('error', { message: 'Session is no longer active' });
    client.disconnect(true);
  }

  private cacheWorkspaceRole(
    client: Socket,
    workspaceId: string,
    role: WorkspaceRole,
  ): void {
    const roles =
      (client.data['workspaceRoles'] as Record<string, WorkspaceRole> | undefined) ?? {};
    roles[workspaceId] = role;
    client.data['workspaceRoles'] = roles;
  }

  private async revokeDocumentAccess(client: Socket, documentId: string): Promise<void> {
    const room = `document:${documentId}`;
    if (!client.rooms.has(room)) return;

    this.removeAwarenessForSocket(client, documentId);
    const roles = client.data['documentRoles'] as
      | Record<string, WorkspaceRole>
      | undefined;
    const workspaces = client.data['documentWorkspaces'] as
      | Record<string, string>
      | undefined;
    if (roles !== undefined) delete roles[documentId];
    if (workspaces !== undefined) delete workspaces[documentId];
    const checkedAt = client.data['documentAuthorizationCheckedAt'] as
      | Record<string, number>
      | undefined;
    if (checkedAt !== undefined) delete checkedAt[documentId];

    await client.leave(room);
    this.registry.leave(client.id, documentId);
    this.documentManager.release(documentId);
    this.server.to(room).emit('userLeft', {
      documentId,
      socketId: client.id,
    });
  }

  private async revokeWorkspaceAccess(client: Socket, workspaceId: string): Promise<void> {
    const workspaceRoom = `workspace:${workspaceId}`;
    if (client.rooms.has(workspaceRoom)) await client.leave(workspaceRoom);

    const workspaceRoles = client.data['workspaceRoles'] as
      | Record<string, WorkspaceRole>
      | undefined;
    if (workspaceRoles !== undefined) delete workspaceRoles[workspaceId];
    const workspaceCheckedAt = client.data['workspaceAuthorizationCheckedAt'] as
      | Record<string, number>
      | undefined;
    if (workspaceCheckedAt !== undefined) delete workspaceCheckedAt[workspaceId];

    const documentWorkspaces = client.data['documentWorkspaces'] as
      | Record<string, string>
      | undefined;
    if (documentWorkspaces === undefined) return;
    const documentIds = Object.entries(documentWorkspaces)
      .filter(([, cachedWorkspaceId]) => cachedWorkspaceId === workspaceId)
      .map(([documentId]) => documentId);
    for (const documentId of documentIds) {
      await this.revokeDocumentAccess(client, documentId);
    }
  }

  private handleAuthorizationInvalidation(
    invalidation: RealtimeAuthorizationInvalidation,
  ): void {
    for (const client of this.connectedClients.values()) {
      const user = client.data['user'] as AuthUser | undefined;
      const jti = client.data[SOCKET_SESSION_JTI] as string | undefined;
      if (
        (invalidation.type === 'session' && invalidation.jti === jti) ||
        (invalidation.type === 'user' && invalidation.userId === user?.id)
      ) {
        this.disconnectForInvalidSession(client, 'authorization:invalidate');
        continue;
      }
      if (
        invalidation.type === 'workspace' &&
        invalidation.userId === user?.id
      ) {
        this.evictWorkspaceAuthorizationCache(client, invalidation.workspaceId);
        void this.refreshWorkspaceAccess(client, invalidation.workspaceId);
      }
    }
  }

  private async refreshWorkspaceAccess(
    client: Socket,
    workspaceId: string,
  ): Promise<void> {
    const user = client.data['user'] as AuthUser | undefined;
    if (user === undefined) {
      this.disconnectForInvalidSession(client, 'authorization:invalidate');
      return;
    }

    const [sessionActive, role] = await Promise.all([
      this.realtimeAuthorization.isSessionActive(client, true),
      this.workspaces.getMemberRole(user.id, workspaceId),
    ]);
    if (!sessionActive) {
      this.disconnectForInvalidSession(client, 'authorization:invalidate');
      return;
    }
    if (role === null) {
      await this.revokeWorkspaceAccess(client, workspaceId);
      return;
    }

    this.cacheWorkspaceRole(client, workspaceId, role);
    const now = Date.now();
    const workspaceCheckedAt =
      (client.data['workspaceAuthorizationCheckedAt'] as
        | Record<string, number>
        | undefined) ?? {};
    workspaceCheckedAt[workspaceId] = now;
    client.data['workspaceAuthorizationCheckedAt'] = workspaceCheckedAt;
    const documentRoles = client.data['documentRoles'] as
      | Record<string, WorkspaceRole>
      | undefined;
    const documentWorkspaces = client.data['documentWorkspaces'] as
      | Record<string, string>
      | undefined;
    if (documentRoles === undefined || documentWorkspaces === undefined) return;
    const documentCheckedAt =
      (client.data['documentAuthorizationCheckedAt'] as
        | Record<string, number>
        | undefined) ?? {};
    for (const [documentId, cachedWorkspaceId] of Object.entries(documentWorkspaces)) {
      if (cachedWorkspaceId === workspaceId) {
        documentRoles[documentId] = role;
        documentCheckedAt[documentId] = now;
      }
    }
    client.data['documentAuthorizationCheckedAt'] = documentCheckedAt;
  }

  private async auditConnectedClients(): Promise<void> {
    if (this.authorizationSweepRunning) return;
    this.authorizationSweepRunning = true;
    try {
      for (const client of this.connectedClients.values()) {
        if (!(await this.realtimeAuthorization.isSessionActive(client, true))) {
          this.disconnectForInvalidSession(client, 'authorization:sweep');
          continue;
        }

        const workspaceIds = new Set<string>();
        const workspaceRoles = client.data['workspaceRoles'] as
          | Record<string, WorkspaceRole>
          | undefined;
        const documentWorkspaces = client.data['documentWorkspaces'] as
          | Record<string, string>
          | undefined;
        for (const workspaceId of Object.keys(workspaceRoles ?? {})) {
          workspaceIds.add(workspaceId);
        }
        for (const workspaceId of Object.values(documentWorkspaces ?? {})) {
          workspaceIds.add(workspaceId);
        }

        for (const workspaceId of workspaceIds) {
          await this.refreshWorkspaceAccess(client, workspaceId);
        }
      }
    } finally {
      this.authorizationSweepRunning = false;
    }
  }

  private evictWorkspaceAuthorizationCache(
    client: Socket,
    workspaceId: string,
  ): void {
    const workspaceCheckedAt = client.data['workspaceAuthorizationCheckedAt'] as
      | Record<string, number>
      | undefined;
    if (workspaceCheckedAt !== undefined) delete workspaceCheckedAt[workspaceId];

    const documentCheckedAt = client.data['documentAuthorizationCheckedAt'] as
      | Record<string, number>
      | undefined;
    const documentWorkspaces = client.data['documentWorkspaces'] as
      | Record<string, string>
      | undefined;
    if (documentCheckedAt === undefined || documentWorkspaces === undefined) return;
    for (const [documentId, cachedWorkspaceId] of Object.entries(documentWorkspaces)) {
      if (cachedWorkspaceId === workspaceId) delete documentCheckedAt[documentId];
    }
  }

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
