import { Injectable, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
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
export class TerminalGateway implements OnGatewayDisconnect {
  private readonly enabled: boolean;

  constructor(
    private readonly terminalService: TerminalService,
    private readonly workspaces: WorkspacesService,
    private readonly prisma: PrismaService,
    configService: ConfigService,
    @InjectPinoLogger(TerminalGateway.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.enabled = config.enableTerminal;
  }

  handleDisconnect(client: Socket): void {
    if (this.terminalService.hasSession(client.id)) {
      this.terminalService.killSession(client.id);
      this.logger.info({ socketId: client.id }, 'Terminal session cleaned up on disconnect');
    }
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

    const user = client.data['user'] as AuthUser | undefined;
    if (!user) {
      client.emit('terminal:error', { message: 'Unauthenticated' });
      return;
    }

    const role = await this.workspaces.getMemberRole(user.id, dto.workspaceId);
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
      client.emit('terminal:status', { status: 'running' });
      return;
    }

    try {
      await this.terminalService.createSession(client.id, user.id, dto.workspaceId, client);
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

    const user = client.data['user'] as AuthUser | undefined;
    if (!user) {
      client.emit('terminal:error', { message: 'Unauthenticated' });
      return;
    }

    const role = await this.workspaces.getMemberRole(user.id, dto.workspaceId);
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
    if (!this.terminalService.hasSession(client.id)) {
      try {
        await this.terminalService.createSession(client.id, user.id, dto.workspaceId, client);
        client.emit('terminal:status', { status: 'ready' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start terminal';
        client.emit('terminal:error', { message });
        return;
      }
    }

    this.terminalService.writeToSession(client.id, `${command}\n`);
  }

  @SubscribeMessage('terminal:input')
  handleInput(
    @MessageBody() dto: TerminalInputDto,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!this.enabled) return;

    if (!this.terminalService.hasSession(client.id)) {
      client.emit('terminal:error', { message: 'No active terminal session; send terminal:start first' });
      return;
    }

    this.terminalService.writeToSession(client.id, dto.data);
  }

  @SubscribeMessage('terminal:resize')
  handleResize(
    @MessageBody() dto: TerminalResizeDto,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!this.enabled) return;

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
    client.emit('terminal:exit', { code: null });
    this.logger.info({ socketId: client.id }, 'Terminal session stopped by client');
  }
}
