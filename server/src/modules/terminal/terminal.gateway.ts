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
  OnGatewayInit,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WorkspaceRole } from '@prisma/client';
import type { Socket } from 'socket.io';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import { WsValidationFilter } from '../realtime/filters/ws-exception.filter';
import { APP_CONFIG_KEY } from '../../config/app.config';
import type { AppConfig } from '../../config/configuration.type';
import type { AuthUser } from '../auth/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { TerminalService } from './terminal.service';
import { assertSafeRelPath, shellQuote } from './path-safety';
import { TerminalStartDto } from './dto/terminal-start.dto';
import { TerminalInputDto } from './dto/terminal-input.dto';
import { TerminalResizeDto } from './dto/terminal-resize.dto';
import { TerminalRunFileDto } from './dto/terminal-run-file.dto';
import { WsRateLimiter } from '../realtime/ws-rate-limiter.service';
import {
  RealtimeAuthorizationService,
  SOCKET_SESSION_JTI,
  type RealtimeAuthorizationInvalidation,
} from '../realtime-authorization/realtime-authorization.service';

const AUTHORIZATION_SWEEP_MS = 10_000;
const AUTHORIZATION_EVENT_CACHE_MS = 1_000;
const TERMINAL_RATE_LIMIT_PREFIX = 'terminal:';

/**
 * Maps a file extension to the shell command that runs it. Returns null for
 * file types Meridian does not execute. The path is single-quoted by the
 * caller, so commands here are safe from shell injection.
 */
export function buildRunCommand(relPath: string): string | null {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  const quoted = shellQuote(relPath);
  switch (ext) {
    case '.py':
      return `python3 ${quoted}`;
    case '.js':
      return `node ${quoted}`;
    case '.ts':
      // tsx if present; otherwise the shell prints an honest "not found" error.
      return `npx --no-install tsx ${quoted}`;
    case '.sh':
      return `bash ${quoted}`;
    default:
      return null;
  }
}

@WebSocketGateway()
@Injectable()
@UseFilters(new WsValidationFilter())
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class TerminalGateway
  implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly enabled: boolean;
  private readonly wsMessageLimit: number;
  private readonly terminalClients = new Map<string, Socket>();
  private readonly unsubscribeAuthorization: () => void;
  private authorizationSweep: NodeJS.Timeout | undefined;
  private authorizationSweepRunning = false;

  constructor(
    private readonly terminalService: TerminalService,
    private readonly workspaces: WorkspacesService,
    private readonly prisma: PrismaService,
    private readonly realtimeAuthorization: RealtimeAuthorizationService,
    private readonly rateLimiter: WsRateLimiter,
    configService: ConfigService,
    @InjectPinoLogger(TerminalGateway.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.enabled = config.enableTerminal;
    this.wsMessageLimit = process.env['E2E_TEST'] === 'true'
      ? 100_000
      : config.wsMessageLimitPerSecond;
    this.unsubscribeAuthorization = this.realtimeAuthorization.onInvalidation(
      (invalidation) => this.handleAuthorizationInvalidation(invalidation),
    );
  }

  afterInit(): void {
    this.authorizationSweep = setInterval(() => {
      void this.auditTerminalClients();
    }, AUTHORIZATION_SWEEP_MS);
    this.authorizationSweep.unref();
  }

  onModuleDestroy(): void {
    if (this.authorizationSweep !== undefined) {
      clearInterval(this.authorizationSweep);
      this.authorizationSweep = undefined;
    }
    this.unsubscribeAuthorization();
    this.terminalClients.clear();
  }

  handleDisconnect(client: Socket): void {
    if (this.terminalService.hasSession(client.id)) {
      this.terminalService.killSession(client.id);
      this.logger.info({ socketId: client.id }, 'Terminal session cleaned up on disconnect');
    }
    this.rateLimiter.clear(this.rateLimitKey(client.id));
    this.terminalClients.delete(client.id);
  }

  @SubscribeMessage('terminal:start')
  async handleStart(
    @MessageBody() dto: TerminalStartDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.enabled) {
      client.emit('terminal:error', { message: 'Terminal feature is disabled on this server' });
      return;
    }
    if (!this.checkRateLimit(client, 'terminal:start')) return;

    const user = client.data['user'] as AuthUser | undefined;
    if (!user) {
      client.emit('terminal:error', { message: 'Unauthenticated' });
      return;
    }

    const role = await this.currentWorkspaceRole(client, dto.workspaceId);
    if (role === undefined) return;
    if (role === null) {
      client.emit('terminal:error', { message: 'Not a member of this workspace' });
      this.logger.warn(
        { socketId: client.id, userId: user.id, workspaceId: dto.workspaceId },
        'Terminal start rejected: non-member',
      );
      return;
    }

    if (role === WorkspaceRole.VIEWER) {
      client.emit('terminal:error', { message: 'Viewers cannot use the terminal' });
      this.logger.warn(
        { socketId: client.id, userId: user.id, workspaceId: dto.workspaceId },
        'Terminal start rejected: viewer',
      );
      return;
    }

    if (this.terminalService.hasSession(client.id)) {
      const session = this.terminalService.getSession(client.id);
      if (
        session?.workspaceId === dto.workspaceId &&
        session.userId === user.id
      ) {
        this.terminalClients.set(client.id, client);
        client.emit('terminal:status', { status: 'running' });
        return;
      }
      this.terminalService.killSession(client.id);
    }

    try {
      await this.terminalService.createSession(client.id, user.id, dto.workspaceId, client);
      this.terminalClients.set(client.id, client);
      client.emit('terminal:status', { status: 'ready' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start terminal';
      this.logger.error({ err, socketId: client.id }, 'Terminal session creation failed');
      client.emit('terminal:error', { message });
    }
  }

  @SubscribeMessage('terminal:run-file')
  async handleRunFile(
    @MessageBody() dto: TerminalRunFileDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.enabled) {
      client.emit('terminal:error', { message: 'Terminal feature is disabled on this server' });
      return;
    }
    if (!this.checkRateLimit(client, 'terminal:run-file')) return;

    const user = client.data['user'] as AuthUser | undefined;
    if (!user) {
      client.emit('terminal:error', { message: 'Unauthenticated' });
      return;
    }

    const role = await this.currentWorkspaceRole(client, dto.workspaceId);
    if (role === undefined) return;
    if (role === null) {
      client.emit('terminal:error', { message: 'Not a member of this workspace' });
      return;
    }
    if (role === WorkspaceRole.VIEWER) {
      client.emit('terminal:error', { message: 'Viewers cannot run files' });
      this.logger.warn(
        { socketId: client.id, userId: user.id, workspaceId: dto.workspaceId },
        'Run-file rejected: viewer',
      );
      return;
    }

    // The document must exist and belong to the claimed workspace.
    const doc = await this.prisma.document.findUnique({
      where: { id: dto.documentId },
      select: { workspaceId: true, type: true, path: true },
    });
    if (doc === null || doc.workspaceId !== dto.workspaceId) {
      client.emit('terminal:error', { message: 'File not found in this workspace' });
      return;
    }
    if (doc.type !== 'FILE') {
      client.emit('terminal:error', { message: 'Only files can be run' });
      return;
    }

    let safePath: string;
    try {
      safePath = assertSafeRelPath(doc.path);
    } catch {
      client.emit('terminal:error', { message: 'File path is not runnable' });
      return;
    }

    const command = buildRunCommand(safePath);
    if (command === null) {
      client.emit('terminal:error', { message: 'This file type is not executable' });
      return;
    }

    // Ensure a session exists (create + materialize if the terminal was closed),
    // then send the command to the PTY so output appears naturally.
    const existingSession = this.terminalService.getSession(client.id);
    if (
      existingSession !== undefined &&
      (existingSession.workspaceId !== dto.workspaceId ||
        existingSession.userId !== user.id)
    ) {
      this.terminalService.killSession(client.id);
    }

    if (!this.terminalService.hasSession(client.id)) {
      try {
        await this.terminalService.createSession(client.id, user.id, dto.workspaceId, client);
        this.terminalClients.set(client.id, client);
        client.emit('terminal:status', { status: 'ready' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start terminal';
        client.emit('terminal:error', { message });
        return;
      }
    }

    this.terminalClients.set(client.id, client);
    this.terminalService.writeToSession(client.id, `${command}\n`);
  }

  @SubscribeMessage('terminal:input')
  async handleInput(
    @MessageBody() dto: TerminalInputDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.enabled) return;
    if (!this.checkRateLimit(client, 'terminal:input')) return;

    const session = this.terminalService.getSession(client.id);
    if (session === undefined) {
      this.terminalClients.delete(client.id);
      client.emit('terminal:error', { message: 'No active terminal session; send terminal:start first' });
      return;
    }

    const role = await this.currentWorkspaceRole(client, session.workspaceId);
    if (role === undefined) return;
    if (role === null || role === WorkspaceRole.VIEWER) {
      this.revokeTerminalAccess(
        client,
        role === WorkspaceRole.VIEWER
          ? 'Viewers cannot use the terminal'
          : 'Not a member of this workspace',
      );
      return;
    }

    this.terminalClients.set(client.id, client);
    this.terminalService.writeToSession(client.id, dto.data);
  }

  @SubscribeMessage('terminal:resize')
  async handleResize(
    @MessageBody() dto: TerminalResizeDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!this.enabled) return;
    if (!this.checkRateLimit(client, 'terminal:resize')) return;

    const session = this.terminalService.getSession(client.id);
    if (session === undefined) return;
    const role = await this.currentWorkspaceRole(client, session.workspaceId);
    if (role === undefined) return;
    if (role === null || role === WorkspaceRole.VIEWER) {
      this.revokeTerminalAccess(client, 'Terminal access was revoked');
      return;
    }

    // Resize the PTY so the shell's TIOCGWINSZ reflects the client viewport.
    // No-ops safely when there is no active session.
    this.terminalService.resizeSession(client.id, dto.cols, dto.rows);
  }

  @SubscribeMessage('terminal:stop')
  handleStop(
    @ConnectedSocket() client: Socket,
  ): void {
    if (!this.terminalService.hasSession(client.id)) return;

    this.terminalService.killSession(client.id);
    this.terminalClients.delete(client.id);
    client.emit('terminal:exit', { code: null });
    this.logger.info({ socketId: client.id }, 'Terminal session stopped by client');
  }

  private rateLimitKey(socketId: string): string {
    return `${TERMINAL_RATE_LIMIT_PREFIX}${socketId}`;
  }

  private checkRateLimit(client: Socket, event: string): boolean {
    if (this.rateLimiter.check(this.rateLimitKey(client.id), this.wsMessageLimit)) {
      return true;
    }
    this.logger.warn(
      { socketId: client.id, event, limit: this.wsMessageLimit },
      'Terminal WebSocket rate limit exceeded — message dropped',
    );
    client.emit('terminal:error', {
      message: `Rate limit exceeded: max ${this.wsMessageLimit} messages/s`,
    });
    return false;
  }

  private async currentWorkspaceRole(
    client: Socket,
    workspaceId: string,
    force = false,
  ): Promise<WorkspaceRole | null | undefined> {
    const user = client.data['user'] as AuthUser | undefined;
    const cachedRoles = client.data['terminalWorkspaceRoles'] as
      | Record<string, WorkspaceRole>
      | undefined;
    const checkedAt = client.data['terminalAuthorizationCheckedAt'] as
      | Record<string, number>
      | undefined;
    const useCachedRole =
      !force &&
      cachedRoles?.[workspaceId] !== undefined &&
      checkedAt?.[workspaceId] !== undefined &&
      Date.now() - checkedAt[workspaceId] < AUTHORIZATION_EVENT_CACHE_MS;
    const rolePromise = useCachedRole
      ? Promise.resolve(cachedRoles[workspaceId]!)
      : user === undefined
        ? Promise.resolve(null)
        : this.workspaces.getMemberRole(user.id, workspaceId);
    const [sessionActive, role] = await Promise.all([
      this.realtimeAuthorization.isSessionActive(client, force),
      rolePromise,
    ]);
    if (!sessionActive || user === undefined) {
      this.revokeTerminalAccess(client, 'Session is no longer active');
      client.disconnect(true);
      return undefined;
    }
    if (role !== null) {
      const roles = cachedRoles ?? {};
      const accessTimes = checkedAt ?? {};
      roles[workspaceId] = role;
      accessTimes[workspaceId] = Date.now();
      client.data['terminalWorkspaceRoles'] = roles;
      client.data['terminalAuthorizationCheckedAt'] = accessTimes;
    }
    return role;
  }

  private revokeTerminalAccess(client: Socket, message: string): void {
    if (this.terminalService.hasSession(client.id)) {
      this.terminalService.killSession(client.id);
      client.emit('terminal:exit', { code: null });
    }
    this.terminalClients.delete(client.id);
    client.emit('terminal:error', { message });
    this.logger.warn(
      { socketId: client.id },
      'Terminal session closed after authorization changed',
    );
  }

  private handleAuthorizationInvalidation(
    invalidation: RealtimeAuthorizationInvalidation,
  ): void {
    for (const client of this.terminalClients.values()) {
      const user = client.data['user'] as AuthUser | undefined;
      const jti = client.data[SOCKET_SESSION_JTI] as string | undefined;
      const session = this.terminalService.getSession(client.id);
      if (session === undefined) {
        this.terminalClients.delete(client.id);
        continue;
      }

      if (
        (invalidation.type === 'session' && invalidation.jti === jti) ||
        (invalidation.type === 'user' && invalidation.userId === user?.id)
      ) {
        this.revokeTerminalAccess(client, 'Session is no longer active');
        client.disconnect(true);
        continue;
      }
      if (
        invalidation.type === 'workspace' &&
        invalidation.userId === user?.id &&
        invalidation.workspaceId === session.workspaceId
      ) {
        this.evictWorkspaceAuthorizationCache(client, invalidation.workspaceId);
        void this.auditTerminalClient(client, true);
      }
    }
  }

  private async auditTerminalClient(client: Socket, force = false): Promise<void> {
    const session = this.terminalService.getSession(client.id);
    if (session === undefined) {
      this.terminalClients.delete(client.id);
      return;
    }
    const role = await this.currentWorkspaceRole(client, session.workspaceId, force);
    if (role === undefined) return;
    if (role === null || role === WorkspaceRole.VIEWER) {
      this.revokeTerminalAccess(client, 'Terminal access was revoked');
    }
  }

  private async auditTerminalClients(): Promise<void> {
    if (this.authorizationSweepRunning) return;
    this.authorizationSweepRunning = true;
    try {
      for (const client of [...this.terminalClients.values()]) {
        await this.auditTerminalClient(client, true);
      }
    } finally {
      this.authorizationSweepRunning = false;
    }
  }

  private evictWorkspaceAuthorizationCache(
    client: Socket,
    workspaceId: string,
  ): void {
    const checkedAt = client.data['terminalAuthorizationCheckedAt'] as
      | Record<string, number>
      | undefined;
    if (checkedAt !== undefined) delete checkedAt[workspaceId];
  }
}
