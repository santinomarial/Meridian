import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Socket } from 'socket.io';

// 30-minute idle timeout; 4-hour absolute lifetime
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LIFETIME_MS = 4 * 60 * 60 * 1000;

// Allowed characters in workspace/user ids used as path segments
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

export interface TerminalSession {
  process: ChildProcess;
  workspaceId: string;
  userId: string;
  sandboxDir: string;
  startedAt: number;
  idleTimer: NodeJS.Timeout;
  lifetimeTimer: NodeJS.Timeout;
}

@Injectable()
export class TerminalService implements OnModuleDestroy {
  // socketId → session
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    @InjectPinoLogger(TerminalService.name)
    private readonly logger: PinoLogger,
  ) {}

  sandboxBaseDir(): string {
    return path.join(process.cwd(), '.terminal-sandboxes');
  }

  getSandboxDir(workspaceId: string, userId: string): string {
    if (!SAFE_ID_RE.test(workspaceId) || !SAFE_ID_RE.test(userId)) {
      throw new Error('Invalid workspaceId or userId for sandbox path');
    }
    return path.join(this.sandboxBaseDir(), workspaceId, userId);
  }

  private ensureSandboxDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
  }

  /**
   * Returns a minimal, safe environment for the shell.
   * Secrets (DATABASE_URL, JWT_SECRET, etc.) are never forwarded.
   */
  private safeEnv(): Record<string, string> {
    const env: Record<string, string> = {
      HOME: process.env['HOME'] ?? '/tmp',
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      TERM: 'xterm-256color',
      SHELL: process.env['SHELL'] ?? '/bin/sh',
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

  getSession(socketId: string): TerminalSession | undefined {
    return this.sessions.get(socketId);
  }

  /**
   * Spawns a shell in the workspace sandbox directory.
   * Emits terminal:output and terminal:exit to the socket.
   */
  createSession(
    socketId: string,
    userId: string,
    workspaceId: string,
    socket: Socket,
  ): TerminalSession {
    if (this.sessions.has(socketId)) {
      this.killSession(socketId);
    }

    const sandboxDir = this.getSandboxDir(workspaceId, userId);
    this.ensureSandboxDir(sandboxDir);

    const shell = process.env['SHELL'] ?? '/bin/sh';
    const child = spawn(shell, ['-i'], {
      cwd: sandboxDir,
      env: this.safeEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
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

    child.stdout.on('data', (chunk: Buffer) => {
      socket.emit('terminal:output', { data: chunk.toString('utf8') });
      resetIdle();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      socket.emit('terminal:output', { data: chunk.toString('utf8') });
      resetIdle();
    });

    child.on('exit', (code) => {
      this.logger.info({ socketId, code }, 'Terminal process exited');
      this.sessions.delete(socketId);
      socket.emit('terminal:exit', { code });
    });

    child.on('error', (err) => {
      this.logger.error({ socketId, err }, 'Terminal process error');
      socket.emit('terminal:error', { message: `Shell error: ${err.message}` });
      this.sessions.delete(socketId);
      socket.emit('terminal:exit', { code: null });
    });

    const session: TerminalSession = {
      process: child,
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
    };

    this.sessions.set(socketId, session);
    resetIdle(); // start the real idle timer

    this.logger.info({ socketId, userId, workspaceId, sandboxDir }, 'Terminal session started');
    return session;
  }

  writeToSession(socketId: string, data: string): boolean {
    const session = this.sessions.get(socketId);
    if (!session) return false;
    try {
      session.process.stdin?.write(data);
      return true;
    } catch {
      return false;
    }
  }

  killSession(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;

    clearTimeout(session.idleTimer);
    clearTimeout(session.lifetimeTimer);

    try {
      session.process.stdin?.end();
      session.process.kill('SIGTERM');
      // Force-kill after 3s if SIGTERM doesn't stop it
      setTimeout(() => {
        try { session.process.kill('SIGKILL'); } catch { /* already dead */ }
      }, 3000).unref();
    } catch {
      // Already exited
    }

    this.sessions.delete(socketId);
    this.logger.info({ socketId }, 'Terminal session killed');
  }

  onModuleDestroy(): void {
    for (const socketId of this.sessions.keys()) {
      this.killSession(socketId);
    }
  }
}
