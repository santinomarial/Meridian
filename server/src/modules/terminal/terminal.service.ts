import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as os from 'os';
import * as pty from 'node-pty';
import type { IPty, IDisposable } from 'node-pty';
import type { Socket } from 'socket.io';
import { TerminalSandboxService } from './terminal-sandbox.service';

// 30-minute idle timeout; 4-hour absolute lifetime
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LIFETIME_MS = 4 * 60 * 60 * 1000;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export interface TerminalSession {
  pty: IPty;
  workspaceId: string;
  userId: string;
  sandboxDir: string;
  startedAt: number;
  idleTimer: NodeJS.Timeout;
  lifetimeTimer: NodeJS.Timeout;
  disposables: IDisposable[];
}

export interface CreateSessionOptions {
  cols?: number;
  rows?: number;
}

@Injectable()
export class TerminalService implements OnModuleDestroy {
  // socketId → session
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly sandbox: TerminalSandboxService,
    @InjectPinoLogger(TerminalService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** The shell to launch — the user's login shell, or a sane default. */
  private resolveShell(): string {
    return process.env['SHELL'] ?? (os.platform() === 'win32' ? 'powershell.exe' : '/bin/bash');
  }

  /**
   * Returns a minimal, safe environment for the shell. Secrets (DATABASE_URL,
   * JWT_SECRET, etc.) are never forwarded. HOME points at the sandbox so `~`
   * and shell rc lookups stay inside the sandbox rather than the server user's
   * real home directory.
   */
  private safeEnv(sandboxDir: string): Record<string, string> {
    const env: Record<string, string> = {
      HOME: sandboxDir,
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      TERM: 'xterm-256color',
      SHELL: this.resolveShell(),
      LANG: process.env['LANG'] ?? 'en_US.UTF-8',
    };
    // Carry over USER/LOGNAME if present (display only, not secret)
    if (process.env['USER']) env['USER'] = process.env['USER'];
    if (process.env['LOGNAME']) env['LOGNAME'] = process.env['LOGNAME'];
    return env;
  }

  hasSession(socketId: string): boolean {
    return this.sessions.has(socketId);
  }

  sessionCount(): number {
    return this.sessions.size;
  }

  getSession(socketId: string): TerminalSession | undefined {
    return this.sessions.get(socketId);
  }

  /**
   * Spawns an interactive PTY shell in the workspace sandbox directory.
   *
   * A real pseudo-terminal (node-pty) is used rather than piped child_process
   * stdio, so the shell behaves like a genuine terminal: it prints its prompt,
   * echoes typed characters, and supports line editing (Backspace, ArrowLeft/
   * Right) and resize — exactly what an interactive client like xterm.js needs.
   *
   * Emits terminal:output and terminal:exit to the socket.
   */
  async createSession(
    socketId: string,
    userId: string,
    workspaceId: string,
    socket: Socket,
    options: CreateSessionOptions = {},
  ): Promise<TerminalSession> {
    if (this.sessions.has(socketId)) {
      this.killSession(socketId);
    }

    // Project the workspace's DB-backed documents onto disk before spawning so
    // `ls`/`pwd` immediately reflect the editor's files.
    const sandboxDir = await this.sandbox.materialize(workspaceId, userId);

    const shell = this.resolveShell();
    // No explicit args: attached to a PTY, the shell detects a TTY and starts
    // interactively on its own (prompt + echo + line editing).
    const child = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols ?? DEFAULT_COLS,
      rows: options.rows ?? DEFAULT_ROWS,
      cwd: sandboxDir,
      env: this.safeEnv(sandboxDir),
    });

    const resetIdle = (): void => {
      clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(() => {
        this.logger.info({ socketId }, 'Terminal idle timeout');
        socket.emit('terminal:output', {
          data: '\r\n\x1b[33m[Meridian] Session closed: idle timeout]\r\n',
        });
        this.killSession(socketId);
        socket.emit('terminal:exit', { code: null });
      }, IDLE_TIMEOUT_MS);
    };

    // node-pty merges stdout and stderr into a single data stream.
    const dataDisposable = child.onData((chunk: string) => {
      socket.emit('terminal:output', { data: chunk });
      resetIdle();
    });

    const exitDisposable = child.onExit(({ exitCode }) => {
      this.logger.info({ socketId, code: exitCode }, 'Terminal process exited');
      this.releaseSession(socketId);
      socket.emit('terminal:exit', { code: exitCode });
    });

    const session: TerminalSession = {
      pty: child,
      workspaceId,
      userId,
      sandboxDir,
      startedAt: Date.now(),
      idleTimer: setTimeout(() => {}, 0), // replaced by resetIdle below
      lifetimeTimer: setTimeout(() => {
        this.logger.info({ socketId }, 'Terminal max lifetime reached');
        socket.emit('terminal:output', {
          data: '\r\n\x1b[33m[Meridian] Session closed: maximum lifetime reached]\r\n',
        });
        this.killSession(socketId);
        socket.emit('terminal:exit', { code: null });
      }, MAX_LIFETIME_MS),
      disposables: [dataDisposable, exitDisposable],
    };

    this.sessions.set(socketId, session);
    resetIdle(); // start the real idle timer

    // Register the sandbox so subsequent editor edits sync into it.
    this.sandbox.registerActive(socketId, workspaceId, userId, sandboxDir, socket);
    socket.emit('terminal:sync', { status: 'synced' });

    this.logger.info({ socketId, userId, workspaceId, sandboxDir }, 'Terminal session started');
    return session;
  }

  /** Writes user keystrokes to the PTY. Returns false if there is no session. */
  writeToSession(socketId: string, data: string): boolean {
    const session = this.sessions.get(socketId);
    if (!session) return false;
    try {
      session.pty.write(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Resizes the PTY so full-screen programs and line wrapping stay correct. */
  resizeSession(socketId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(socketId);
    if (!session) return false;
    try {
      session.pty.resize(cols, rows);
      return true;
    } catch {
      // Non-fatal: the shell may have already exited.
      return false;
    }
  }

  /**
   * Removes all local references to a session and its sandbox projection.
   * This is shared by explicit kills and natural PTY exits so an exited shell
   * cannot continue receiving document-to-sandbox sync operations.
   */
  private releaseSession(socketId: string): TerminalSession | undefined {
    const session = this.sessions.get(socketId);
    if (!session) return undefined;
    clearTimeout(session.idleTimer);
    clearTimeout(session.lifetimeTimer);
    for (const disposable of session.disposables) {
      try { disposable.dispose(); } catch { /* already disposed */ }
    }
    this.sessions.delete(socketId);
    this.sandbox.unregister(socketId);
    return session;
  }

  killSession(socketId: string): void {
    const session = this.releaseSession(socketId);
    if (!session) return;

    try {
      session.pty.kill();
      // Force-kill after 3s if a graceful kill doesn't stop it.
      const child = session.pty;
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 3000).unref();
    } catch {
      // Already exited
    }

    this.logger.info({ socketId }, 'Terminal session killed');
  }

  onModuleDestroy(): void {
    for (const socketId of this.sessions.keys()) {
      this.killSession(socketId);
    }
  }
}
