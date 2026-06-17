import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { WorkspaceRole } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { Socket } from 'socket.io';
import type { AuthUser } from '../auth/types/auth-user.type';
import type { WorkspacesService } from '../../workspaces/workspaces.service';
import { TerminalGateway } from './terminal.gateway';
import { TerminalService } from './terminal.service';
import type { TerminalStartDto } from './dto/terminal-start.dto';
import type { TerminalInputDto } from './dto/terminal-input.dto';
import type { TerminalResizeDto } from './dto/terminal-resize.dto';
import type { TerminalSession } from './terminal.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUTH_USER: AuthUser = {
  id: 'user-1',
  email: 'user@example.com',
  displayName: 'Alice',
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

function makeSocket(
  overrides: Partial<{ user: AuthUser | undefined; id: string }> = {},
): { socket: Socket; emitted: Array<[string, unknown]> } {
  const emitted: Array<[string, unknown]> = [];
  const user = 'user' in overrides ? overrides.user : AUTH_USER;
  const socket = {
    id: overrides.id ?? 'socket-1',
    data: user !== undefined ? { user } : {},
    emit: (event: string, data: unknown) => {
      emitted.push([event, data]);
    },
    rooms: new Set<string>(),
  } as unknown as Socket;
  return { socket, emitted };
}

function makeGateway(enableTerminal: boolean): {
  gateway: TerminalGateway;
  terminalService: DeepMockProxy<TerminalService>;
  workspaces: DeepMockProxy<WorkspacesService>;
} {
  const terminalService = mockDeep<TerminalService>();
  const workspaces = mockDeep<WorkspacesService>();
  const configService = mockDeep<ConfigService>();
  const logger = mockDeep<PinoLogger>();

  configService.getOrThrow.mockReturnValue({ enableTerminal } as never);

  const gateway = new TerminalGateway(
    terminalService,
    workspaces,
    configService,
    logger,
  );

  return { gateway, terminalService, workspaces };
}

// ---------------------------------------------------------------------------
// terminal:start
// ---------------------------------------------------------------------------

describe('TerminalGateway', () => {
  describe('handleStart', () => {
    const dto: TerminalStartDto = { workspaceId: 'ws-1' };

    it('emits terminal:error when feature is disabled', async () => {
      const { gateway } = makeGateway(false);
      const { socket, emitted } = makeSocket();

      await gateway.handleStart(dto, socket);

      expect(emitted).toContainEqual([
        'terminal:error',
        { message: 'Terminal feature is disabled on this server' },
      ]);
    });

    it('emits terminal:error when socket has no user (unauthenticated)', async () => {
      const { gateway } = makeGateway(true);
      const { socket, emitted } = makeSocket({ user: undefined });

      await gateway.handleStart(dto, socket);

      expect(emitted).toContainEqual(['terminal:error', { message: 'Unauthenticated' }]);
    });

    it('emits terminal:error when user is not a workspace member', async () => {
      const { gateway, workspaces } = makeGateway(true);
      workspaces.getMemberRole.mockResolvedValue(null);
      const { socket, emitted } = makeSocket();

      await gateway.handleStart(dto, socket);

      expect(emitted).toContainEqual([
        'terminal:error',
        { message: 'Not a member of this workspace' },
      ]);
    });

    it('emits terminal:error when user role is VIEWER', async () => {
      const { gateway, workspaces } = makeGateway(true);
      workspaces.getMemberRole.mockResolvedValue(WorkspaceRole.VIEWER);
      const { socket, emitted } = makeSocket();

      await gateway.handleStart(dto, socket);

      expect(emitted).toContainEqual([
        'terminal:error',
        { message: 'Viewers cannot use the terminal' },
      ]);
    });

    it('emits terminal:status running when a session already exists', async () => {
      const { gateway, workspaces, terminalService } = makeGateway(true);
      workspaces.getMemberRole.mockResolvedValue(WorkspaceRole.EDITOR);
      terminalService.hasSession.mockReturnValue(true);
      const { socket, emitted } = makeSocket();

      await gateway.handleStart(dto, socket);

      expect(terminalService.createSession).not.toHaveBeenCalled();
      expect(emitted).toContainEqual(['terminal:status', { status: 'running' }]);
    });

    it('creates a session and emits terminal:status ready for EDITOR', async () => {
      const { gateway, workspaces, terminalService } = makeGateway(true);
      workspaces.getMemberRole.mockResolvedValue(WorkspaceRole.EDITOR);
      terminalService.hasSession.mockReturnValue(false);
      terminalService.createSession.mockReturnValue({} as TerminalSession);
      const { socket, emitted } = makeSocket();

      await gateway.handleStart(dto, socket);

      expect(terminalService.createSession).toHaveBeenCalledWith(
        'socket-1',
        'user-1',
        'ws-1',
        socket,
      );
      expect(emitted).toContainEqual(['terminal:status', { status: 'ready' }]);
    });

    it('creates a session and emits terminal:status ready for OWNER', async () => {
      const { gateway, workspaces, terminalService } = makeGateway(true);
      workspaces.getMemberRole.mockResolvedValue(WorkspaceRole.OWNER);
      terminalService.hasSession.mockReturnValue(false);
      terminalService.createSession.mockReturnValue({} as TerminalSession);
      const { socket, emitted } = makeSocket();

      await gateway.handleStart(dto, socket);

      expect(terminalService.createSession).toHaveBeenCalled();
      expect(emitted).toContainEqual(['terminal:status', { status: 'ready' }]);
    });

    it('emits terminal:error when createSession throws', async () => {
      const { gateway, workspaces, terminalService } = makeGateway(true);
      workspaces.getMemberRole.mockResolvedValue(WorkspaceRole.EDITOR);
      terminalService.hasSession.mockReturnValue(false);
      terminalService.createSession.mockImplementation(() => {
        throw new Error('spawn failed');
      });
      const { socket, emitted } = makeSocket();

      await gateway.handleStart(dto, socket);

      expect(emitted).toContainEqual(['terminal:error', { message: 'spawn failed' }]);
    });
  });

  // ── terminal:input ─────────────────────────────────────────────────────────

  describe('handleInput', () => {
    const dto: TerminalInputDto = { data: 'ls\n' };

    it('does nothing when feature is disabled', () => {
      const { gateway } = makeGateway(false);
      const { socket, emitted } = makeSocket();
      gateway.handleInput(dto, socket);
      expect(emitted).toHaveLength(0);
    });

    it('emits terminal:error when no session exists', () => {
      const { gateway, terminalService } = makeGateway(true);
      terminalService.hasSession.mockReturnValue(false);
      const { socket, emitted } = makeSocket();

      gateway.handleInput(dto, socket);

      expect(emitted).toContainEqual([
        'terminal:error',
        { message: 'No active terminal session; send terminal:start first' },
      ]);
    });

    it('writes data to the session when session exists', () => {
      const { gateway, terminalService } = makeGateway(true);
      terminalService.hasSession.mockReturnValue(true);
      const { socket } = makeSocket();

      gateway.handleInput(dto, socket);

      expect(terminalService.writeToSession).toHaveBeenCalledWith('socket-1', 'ls\n');
    });
  });

  // ── terminal:resize ────────────────────────────────────────────────────────

  describe('handleResize', () => {
    const dto: TerminalResizeDto = { cols: 80, rows: 24 };

    it('does nothing when feature is disabled', () => {
      const { gateway, terminalService } = makeGateway(false);
      const { socket } = makeSocket();
      gateway.handleResize(dto, socket);
      expect(terminalService.getSession).not.toHaveBeenCalled();
    });

    it('does nothing when no session exists', () => {
      const { gateway, terminalService } = makeGateway(true);
      terminalService.getSession.mockReturnValue(undefined);
      const { socket, emitted } = makeSocket();

      gateway.handleResize(dto, socket);

      expect(emitted).toHaveLength(0);
    });
  });

  // ── terminal:stop ──────────────────────────────────────────────────────────

  describe('handleStop', () => {
    it('does nothing when no session exists', () => {
      const { gateway, terminalService } = makeGateway(true);
      terminalService.hasSession.mockReturnValue(false);
      const { socket, emitted } = makeSocket();

      gateway.handleStop(socket);

      expect(terminalService.killSession).not.toHaveBeenCalled();
      expect(emitted).toHaveLength(0);
    });

    it('kills the session and emits terminal:exit', () => {
      const { gateway, terminalService } = makeGateway(true);
      terminalService.hasSession.mockReturnValue(true);
      const { socket, emitted } = makeSocket();

      gateway.handleStop(socket);

      expect(terminalService.killSession).toHaveBeenCalledWith('socket-1');
      expect(emitted).toContainEqual(['terminal:exit', { code: null }]);
    });
  });

  // ── handleDisconnect ───────────────────────────────────────────────────────

  describe('handleDisconnect', () => {
    it('kills the session when one exists on disconnect', () => {
      const { gateway, terminalService } = makeGateway(true);
      terminalService.hasSession.mockReturnValue(true);
      const { socket } = makeSocket();

      gateway.handleDisconnect(socket);

      expect(terminalService.killSession).toHaveBeenCalledWith('socket-1');
    });

    it('does not crash when no session exists on disconnect', () => {
      const { gateway, terminalService } = makeGateway(true);
      terminalService.hasSession.mockReturnValue(false);
      const { socket } = makeSocket();

      expect(() => gateway.handleDisconnect(socket)).not.toThrow();
      expect(terminalService.killSession).not.toHaveBeenCalled();
    });
  });
});
