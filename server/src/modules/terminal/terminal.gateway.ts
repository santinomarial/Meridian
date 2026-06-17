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
import { TerminalService } from './terminal.service';
import { TerminalStartDto } from './dto/terminal-start.dto';
import { TerminalInputDto } from './dto/terminal-input.dto';
import { TerminalResizeDto } from './dto/terminal-resize.dto';

@WebSocketGateway()
@Injectable()
@UseFilters(new WsValidationFilter())
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class TerminalGateway implements OnGatewayDisconnect {
  private readonly enabled: boolean;

  constructor(
    private readonly terminalService: TerminalService,
    private readonly workspaces: WorkspacesService,
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
      this.terminalService.createSession(client.id, user.id, dto.workspaceId, client);
      client.emit('terminal:status', { status: 'ready' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start terminal';
      this.logger.error({ err, socketId: client.id }, 'Terminal session creation failed');
      client.emit('terminal:error', { message });
    }
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

    const session = this.terminalService.getSession(client.id);
    if (!session) return;

    try {
      // Notify the shell of the new terminal size via SIGWINCH / ioctl.
      // With child_process.spawn (no PTY), resize is best-effort — shells that
      // query TIOCGWINSZ will not see the change, but it won't crash anything.
      session.process.kill('SIGWINCH');
    } catch {
      // Non-fatal: shell may already have exited
    }
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
