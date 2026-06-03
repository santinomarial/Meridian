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
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { toAuthUser } from '../auth/auth.service';
import { ORIGIN_ID } from './origin';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { WsRateLimiter } from './ws-rate-limiter.service';
import { JoinDocumentDto } from './dto/join-document.dto';
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
    this.wsMessageLimit = config.wsMessageLimitPerSecond;
    this.wsMaxUpdateBytes = config.wsMaxYjsUpdateBytes;
  }

  // ---------------------------------------------------------------------------
  // Gateway init — auth middleware + Redis subscriptions
  // ---------------------------------------------------------------------------

  async afterInit(): Promise<void> {
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

    // Authorization: the socket user must be a member of the document's workspace.
    const authorized = await this.workspaces.canUserAccessDocument(
      user.id,
      dto.documentId,
    );
    if (!authorized) {
      client.emit('error', {
        message: `Access denied to document ${dto.documentId}`,
      });
      this.logger.warn(
        { socketId: client.id, userId: user.id, documentId: dto.documentId },
        'Unauthorized joinDocument attempt',
      );
      return;
    }

    const room = `document:${dto.documentId}`;

    await client.join(room);
    this.registry.join(client.id, dto.documentId);

    const doc = await this.documentManager.acquire(dto.documentId);

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
    if (!this.checkRateLimit(client, 'yjs:sync')) return;

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

    syncProtocol.readSyncMessage(decoder, responseEncoder, doc, null);

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
