import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Server, Socket } from 'socket.io';
import type { User, Session } from '@prisma/client';
import { EditorGateway, extractSocketToken } from './editor.gateway';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { WsRateLimiter } from './ws-rate-limiter.service';
import { RedisService } from '../../redis/redis.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceRole } from '@prisma/client';
import type { JwtPayload } from '../auth/types/auth-user.type';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_USER: User = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  passwordHash: null,
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const VALID_PAYLOAD: JwtPayload = {
  sub: 'user-1',
  email: 'alice@example.com',
  jti: 'jti-abc',
};

const VALID_SESSION: Session & { user: User } = {
  id: 'sess-1',
  userId: 'user-1',
  jti: 'jti-abc',
  expiresAt: new Date(Date.now() + 3_600_000),
  revokedAt: null,
  createdAt: new Date('2024-01-01'),
  user: BASE_USER,
};

const AUTH_USER = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
  createdAt: BASE_USER.createdAt,
  updatedAt: BASE_USER.updatedAt,
};

// ---------------------------------------------------------------------------
// Gateway factory
// ---------------------------------------------------------------------------

const DEFAULT_WS_LIMIT = 50;
const DEFAULT_MAX_BYTES = 1_048_576;

function makeGateway(opts?: { wsLimit?: number; maxBytes?: number }) {
  const registry = new ConnectionRegistryService();
  const prisma = mockDeep<PrismaService>();
  const jwtService = mockDeep<JwtService>();
  const workspaces = mockDeep<WorkspacesService>();
  const redis = mockDeep<RedisService>();
  const documentManager = mockDeep<DocumentManagerService>();
  const persistence = mockDeep<DocumentPersistenceService>();
  const rateLimiter = new WsRateLimiter();
  const configService = mockDeep<ConfigService>();
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    assign: jest.fn(),
  };

  Object.defineProperty(redis, 'isAvailable', { get: () => false, configurable: true });
  redis.subscribe.mockResolvedValue(undefined);

  configService.getOrThrow.mockReturnValue({
    wsMessageLimitPerSecond: opts?.wsLimit ?? DEFAULT_WS_LIMIT,
    wsMaxYjsUpdateBytes: opts?.maxBytes ?? DEFAULT_MAX_BYTES,
  } as never);

  const gateway = new EditorGateway(
    registry,
    documentManager,
    persistence,
    redis,
    jwtService,
    prisma,
    workspaces,
    rateLimiter,
    configService,
    logger as never,
  );

  const server = mockDeep<Server>();
  gateway.server = server;

  return { gateway, registry, prisma, jwtService, workspaces, documentManager, server, rateLimiter };
}

function makeSocket(overrides?: {
  id?: string;
  data?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  cookie?: string;
}): DeepMockProxy<Socket> {
  const socket = mockDeep<Socket>();
  const id = overrides?.id ?? 'sock-1';
  Object.defineProperty(socket, 'id', { value: id, configurable: true });
  Object.defineProperty(socket, 'data', {
    value: overrides?.data ?? {},
    writable: true,
    configurable: true,
  });
  Object.defineProperty(socket, 'handshake', {
    value: {
      auth: overrides?.auth ?? {},
      headers: overrides?.cookie ? { cookie: overrides.cookie } : {},
    },
    configurable: true,
  });
  return socket;
}

// ---------------------------------------------------------------------------
// extractSocketToken (unit)
// ---------------------------------------------------------------------------

describe('extractSocketToken', () => {
  it('returns token from handshake.auth.token', () => {
    const socket = makeSocket({ auth: { token: 'auth-tok' } });
    expect(extractSocketToken(socket)).toBe('auth-tok');
  });

  it('returns token from auth_token cookie header', () => {
    const socket = makeSocket({ cookie: 'auth_token=cookie-tok; Path=/' });
    expect(extractSocketToken(socket)).toBe('cookie-tok');
  });

  it('prefers auth.token over cookie', () => {
    const socket = makeSocket({
      auth: { token: 'auth-tok' },
      cookie: 'auth_token=cookie-tok',
    });
    expect(extractSocketToken(socket)).toBe('auth-tok');
  });

  it('returns null when no token present', () => {
    const socket = makeSocket();
    expect(extractSocketToken(socket)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Socket authentication
// ---------------------------------------------------------------------------

describe('EditorGateway.authenticateSocket', () => {
  it('throws when no token is present', async () => {
    const { gateway } = makeGateway();
    const socket = makeSocket();

    await expect(gateway.authenticateSocket(socket)).rejects.toThrow(
      'No authentication token',
    );
  });

  it('throws when JWT is invalid', async () => {
    const { gateway, jwtService } = makeGateway();
    const socket = makeSocket({ auth: { token: 'bad' } });

    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt malformed');
    });

    await expect(gateway.authenticateSocket(socket)).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('throws when session does not exist', async () => {
    const { gateway, jwtService, prisma } = makeGateway();
    const socket = makeSocket({ auth: { token: 'tok' } });

    jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
    prisma.session.findUnique.mockResolvedValue(null);

    await expect(gateway.authenticateSocket(socket)).rejects.toThrow(
      'Session not found',
    );
  });

  it('throws when session is expired', async () => {
    const { gateway, jwtService, prisma } = makeGateway();
    const socket = makeSocket({ auth: { token: 'tok' } });

    jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
    prisma.session.findUnique.mockResolvedValue({
      ...VALID_SESSION,
      expiresAt: new Date(Date.now() - 1000),
    } as never);

    await expect(gateway.authenticateSocket(socket)).rejects.toThrow('Session expired');
  });

  it('throws when session is revoked', async () => {
    const { gateway, jwtService, prisma } = makeGateway();
    const socket = makeSocket({ auth: { token: 'tok' } });

    jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
    prisma.session.findUnique.mockResolvedValue({
      ...VALID_SESSION,
      revokedAt: new Date(Date.now() - 1000),
    } as never);

    await expect(gateway.authenticateSocket(socket)).rejects.toThrow('Session revoked');
  });

  it('attaches user to socket.data on success', async () => {
    const { gateway, jwtService, prisma } = makeGateway();
    const socket = makeSocket({ auth: { token: 'tok' } });

    jwtService.verify.mockReturnValue(VALID_PAYLOAD as never);
    prisma.session.findUnique.mockResolvedValue(VALID_SESSION as never);

    await gateway.authenticateSocket(socket);

    expect(socket.data['user']).toMatchObject({ id: 'user-1', email: 'alice@example.com' });
  });
});

// ---------------------------------------------------------------------------
// Document authorization (handleJoinDocument)
// ---------------------------------------------------------------------------

describe('EditorGateway.handleJoinDocument', () => {
  function makeAuthenticatedSocket(id = 'sock-1'): DeepMockProxy<Socket> {
    const socket = makeSocket({ id, data: { user: AUTH_USER } });
    socket.join.mockResolvedValue(undefined as never);
    socket.to.mockReturnValue({ emit: jest.fn() } as never);
    return socket;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits error and does not join room when user is not authorized', async () => {
    const { gateway, workspaces } = makeGateway();
    const socket = makeAuthenticatedSocket();

    workspaces.getDocumentAccessInfo.mockResolvedValue(null);

    await gateway.handleJoinDocument({ documentId: 'doc-1' }, socket);

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringContaining('Access denied') as string }),
    );
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('joins the room when user is authorized', async () => {
    const { gateway, workspaces, documentManager } = makeGateway();
    const socket = makeAuthenticatedSocket();

    workspaces.getDocumentAccessInfo.mockResolvedValue({
      workspaceId: 'ws-1',
      role: WorkspaceRole.EDITOR,
    });

    const { Doc } = await import('yjs');
    const doc = new Doc();
    documentManager.acquire.mockResolvedValue(doc);

    const { Awareness } = await import('y-protocols/awareness');
    const awareness = new Awareness(doc);
    documentManager.getAwareness.mockReturnValue(awareness);

    await gateway.handleJoinDocument({ documentId: 'doc-1' }, socket);

    expect(socket.join).toHaveBeenCalledWith('document:doc-1');
    expect(socket.emit).toHaveBeenCalledWith(
      'joinedDocument',
      expect.objectContaining({ documentId: 'doc-1' }) as object,
    );
  });

  it('owner (member with OWNER role) has access and caches role', async () => {
    const { gateway, workspaces, documentManager } = makeGateway();
    const socket = makeAuthenticatedSocket();

    workspaces.getDocumentAccessInfo.mockResolvedValue({
      workspaceId: 'ws-1',
      role: WorkspaceRole.OWNER,
    });

    const { Doc } = await import('yjs');
    const doc = new Doc();
    documentManager.acquire.mockResolvedValue(doc);

    const { Awareness } = await import('y-protocols/awareness');
    documentManager.getAwareness.mockReturnValue(new Awareness(doc));

    await gateway.handleJoinDocument({ documentId: 'doc-1' }, socket);

    expect(workspaces.getDocumentAccessInfo).toHaveBeenCalledWith('user-1', 'doc-1');
    expect(socket.join).toHaveBeenCalled();
    expect((socket.data['documentRoles'] as Record<string, WorkspaceRole>)['doc-1']).toBe(
      WorkspaceRole.OWNER,
    );
  });

  it('viewer (member with VIEWER role) can join', async () => {
    const { gateway, workspaces, documentManager } = makeGateway();
    const socket = makeAuthenticatedSocket();

    workspaces.getDocumentAccessInfo.mockResolvedValue({
      workspaceId: 'ws-1',
      role: WorkspaceRole.VIEWER,
    });

    const { Doc } = await import('yjs');
    const doc = new Doc();
    documentManager.acquire.mockResolvedValue(doc);

    const { Awareness } = await import('y-protocols/awareness');
    documentManager.getAwareness.mockReturnValue(new Awareness(doc));

    await gateway.handleJoinDocument({ documentId: 'doc-1' }, socket);

    expect(socket.join).toHaveBeenCalledWith('document:doc-1');
    expect((socket.data['documentRoles'] as Record<string, WorkspaceRole>)['doc-1']).toBe(
      WorkspaceRole.VIEWER,
    );
  });

  it('non-member is denied', async () => {
    const { gateway, workspaces } = makeGateway();
    const socket = makeAuthenticatedSocket();

    workspaces.getDocumentAccessInfo.mockResolvedValue(null);

    await gateway.handleJoinDocument({ documentId: 'doc-1' }, socket);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringContaining('Access denied') as string }),
    );
  });

  it('uses real userId from socket.data, not DTO', async () => {
    const { gateway, workspaces, documentManager } = makeGateway();
    const socket = makeAuthenticatedSocket();

    workspaces.getDocumentAccessInfo.mockResolvedValue({
      workspaceId: 'ws-1',
      role: WorkspaceRole.EDITOR,
    });

    const { Doc } = await import('yjs');
    const doc = new Doc();
    documentManager.acquire.mockResolvedValue(doc);

    const { Awareness } = await import('y-protocols/awareness');
    documentManager.getAwareness.mockReturnValue(new Awareness(doc));

    await gateway.handleJoinDocument(
      { documentId: 'doc-1', userId: 'evil-override', displayName: 'Hacker' },
      socket,
    );

    expect(workspaces.getDocumentAccessInfo).toHaveBeenCalledWith('user-1', 'doc-1');
  });
});

// ---------------------------------------------------------------------------
// Viewer yjs:update rejection
// ---------------------------------------------------------------------------

describe('EditorGateway.handleYjsUpdate — viewer rejection', () => {
  it('rejects a yjs:update from a VIEWER and emits error', () => {
    const { gateway } = makeGateway();
    const socket = makeSocket({
      data: {
        user: AUTH_USER,
        documentRoles: { 'doc-1': WorkspaceRole.VIEWER },
      },
    });
    socket.to.mockReturnValue({ emit: jest.fn() } as never);

    gateway.handleYjsUpdate({ documentId: 'doc-1', update: new Uint8Array(10) }, socket);

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringContaining('Viewers cannot') as string }),
    );
  });

  it('allows a yjs:update from an EDITOR', () => {
    const { gateway, documentManager } = makeGateway();
    const socket = makeSocket({
      data: {
        user: AUTH_USER,
        documentRoles: { 'doc-1': WorkspaceRole.EDITOR },
      },
    });
    socket.to.mockReturnValue({ emit: jest.fn() } as never);

    documentManager.hasDocument.mockReturnValue(true);
    documentManager.applyUpdate.mockImplementation(() => undefined);

    gateway.handleYjsUpdate({ documentId: 'doc-1', update: new Uint8Array(10) }, socket);

    expect(documentManager.applyUpdate).toHaveBeenCalled();
  });

  it('allows a yjs:update from an OWNER', () => {
    const { gateway, documentManager } = makeGateway();
    const socket = makeSocket({
      data: {
        user: AUTH_USER,
        documentRoles: { 'doc-1': WorkspaceRole.OWNER },
      },
    });
    socket.to.mockReturnValue({ emit: jest.fn() } as never);

    documentManager.hasDocument.mockReturnValue(true);
    documentManager.applyUpdate.mockImplementation(() => undefined);

    gateway.handleYjsUpdate({ documentId: 'doc-1', update: new Uint8Array(10) }, socket);

    expect(documentManager.applyUpdate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Part 3 (new) — Payload cap on yjs:update
// ---------------------------------------------------------------------------

describe('EditorGateway.handleYjsUpdate — payload cap', () => {
  function makeAuthenticatedSocket(): DeepMockProxy<Socket> {
    const socket = makeSocket({ data: { user: AUTH_USER } });
    socket.to.mockReturnValue({ emit: jest.fn() } as never);
    return socket;
  }

  it('rejects an oversized Yjs update and emits error', () => {
    const maxBytes = 100;
    const { gateway, documentManager } = makeGateway({ maxBytes });
    const socket = makeAuthenticatedSocket();

    const oversized = new Uint8Array(maxBytes + 1);
    gateway.handleYjsUpdate({ documentId: 'doc-1', update: oversized }, socket);

    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringContaining('Payload too large') as string }),
    );
    expect(documentManager.applyUpdate).not.toHaveBeenCalled();
  });

  it('does not persist or relay an oversized update', () => {
    const maxBytes = 100;
    const { gateway, documentManager } = makeGateway({ maxBytes });
    const socket = makeAuthenticatedSocket();

    const oversized = new Uint8Array(maxBytes + 1);
    gateway.handleYjsUpdate({ documentId: 'doc-1', update: oversized }, socket);

    expect(documentManager.applyUpdate).not.toHaveBeenCalled();
  });

  it('accepts an update at exactly the byte limit', () => {
    const maxBytes = 100;
    const { gateway, documentManager } = makeGateway({ maxBytes });
    const socket = makeAuthenticatedSocket();

    documentManager.hasDocument.mockReturnValue(true);
    documentManager.applyUpdate.mockImplementation(() => undefined);

    const exactly = new Uint8Array(maxBytes);
    gateway.handleYjsUpdate({ documentId: 'doc-1', update: exactly }, socket);

    expect(documentManager.applyUpdate).toHaveBeenCalledWith('doc-1', exactly);
  });
});

// ---------------------------------------------------------------------------
// Part 2 (new) — WebSocket rate limiting
// ---------------------------------------------------------------------------

describe('EditorGateway — WebSocket rate limiting', () => {
  it('drops a yjs:update that exceeds the per-second limit', () => {
    const wsLimit = 3;
    const { gateway, documentManager } = makeGateway({ wsLimit });
    const socket = makeSocket({ data: { user: AUTH_USER } });
    socket.to.mockReturnValue({ emit: jest.fn() } as never);

    const smallUpdate = new Uint8Array(10);
    documentManager.hasDocument.mockReturnValue(true);
    documentManager.applyUpdate.mockImplementation(() => undefined);

    // First 3 calls should pass
    for (let i = 0; i < wsLimit; i++) {
      gateway.handleYjsUpdate({ documentId: 'doc-1', update: smallUpdate }, socket);
    }

    // The 4th call exceeds the limit
    gateway.handleYjsUpdate({ documentId: 'doc-1', update: smallUpdate }, socket);

    // applyUpdate called exactly wsLimit times (not on the rate-limited 4th)
    expect(documentManager.applyUpdate).toHaveBeenCalledTimes(wsLimit);
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringContaining('Rate limit') as string }),
    );
  });
});

// ---------------------------------------------------------------------------
// workspaces.service — createWorkspace adds owner as OWNER member
// ---------------------------------------------------------------------------

describe('WorkspacesService.createWorkspace (owner membership)', () => {
  it('tests delegated to workspaces.service.spec.ts', () => {
    expect(true).toBe(true);
  });
});
