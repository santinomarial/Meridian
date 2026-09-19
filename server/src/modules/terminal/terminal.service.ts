import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as os from 'os';
import { basename } from 'path';
import * as pty from 'node-pty';
import type { IDisposable } from 'node-pty';
import type { Socket } from 'socket.io';
import { IsolatedTerminalService, type TerminalProcess } from './isolated-terminal.service';
import { TerminalSandboxService } from './terminal-sandbox.service';

// 30-minute idle timeout; 4-hour absolute lifetime
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LIFETIME_MS = 4 * 60 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 3000;
const KILL_CLEANUP_DELAY_MS = FORCE_KILL_DELAY_MS + 100;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export interface TerminalSession {
  pty: TerminalProcess;
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
  private readonly starting = new Map<string, { cancelled: boolean; promise: Promise<TerminalSession> }>();
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly sandbox: TerminalSandboxService,
    @InjectPinoLogger(TerminalService.name)
    private readonly logger: PinoLogger,
    @Optional() private readonly runner?: IsolatedTerminalService,
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
    const shell = this.resolveShell();
    const env: Record<string, string> = {
      HOME: sandboxDir,
      PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      TERM: 'xterm-256color',
      SHELL: shell,
      LANG: process.env['LANG'] ?? 'en_US.UTF-8',
    };
    // Carry over USER/LOGNAME if present (display only, not secret)
    if (process.env['USER']) env['USER'] = process.env['USER'];
    if (process.env['LOGNAME']) env['LOGNAME'] = process.env['LOGNAME'];
    // Keep the current folder visible without a host/user prefix consuming
    // most of a narrow terminal. Do not apply POSIX prompts to other shells.
    const shellName = basename(shell);
    if (shellName === 'zsh') env['PS1'] = '%1~ %# ';
    if (shellName === 'bash') env['PS1'] = '\\W \\$ ';
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
  createSession(socketId: string, userId: string, workspaceId: string, socket: Socket, options: CreateSessionOptions = {}): Promise<TerminalSession> {
    if (process.env['NODE_ENV'] === 'production' && !this.runner?.enabled) {
      return Promise.reject(new Error('Production terminals require an isolated worker'));
    }
    if (this.starting.has(socketId)) return Promise.reject(new Error('Terminal is already starting'));
    if (this.sessions.has(socketId)) this.killSession(socketId);
    if (this.starting.size + this.sessions.size >= 32) return Promise.reject(new Error('Terminal capacity reached'));
    const attempt = { cancelled: false, promise: undefined as unknown as Promise<TerminalSession> };
    this.starting.set(socketId, attempt);
    attempt.promise = this.startSession(socketId, userId, workspaceId, socket, options, () => attempt.cancelled)
      .finally(() => { if (this.starting.get(socketId) === attempt) this.starting.delete(socketId); });
    return attempt.promise;
  }

  private async startSession(
    socketId: string,
    userId: string,
    workspaceId: string,
    socket: Socket,
    options: CreateSessionOptions,
    cancelled: () => boolean,
  ): Promise<TerminalSession> {
    if (this.sessions.has(socketId)) throw new Error('Terminal session is still closing');

    // Project the workspace's DB-backed documents onto disk before spawning so
    // `ls`/`pwd` immediately reflect the editor's files.
    const sandboxDir = await this.sandbox.materialize(socketId, workspaceId, userId);

    if (cancelled()) { await this.sandbox.unregister(socketId); throw new Error('Terminal start cancelled'); }
    const shell = this.resolveShell();
    // Host startup files can override the compact workspace prompt. These
    // shells still detect the PTY and retain interactive line editing.
    const shellName = basename(shell);
    const shellArgs = shellName === 'zsh'
      ? ['-f']
      : shellName === 'bash' ? ['--noprofile', '--norc'] : [];
    let child: TerminalProcess;
    try {
      child = this.runner?.enabled ? await this.runner.spawn(sandboxDir) : pty.spawn(shell, shellArgs, {
        name: 'xterm-256color',
        cols: options.cols ?? DEFAULT_COLS,
        rows: options.rows ?? DEFAULT_ROWS,
        cwd: sandboxDir,
        env: this.safeEnv(sandboxDir),
      });
    } catch (err) {
      await this.sandbox.unregister(socketId);
      throw err;
    }

    if (cancelled()) {
      child.kill('SIGKILL');
      await this.sandbox.unregister(socketId);
      throw new Error('Terminal start cancelled');
    }

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
    try {
      this.sandbox.registerActive(socketId, workspaceId, userId, sandboxDir, socket);
    } catch (err) {
      const released = this.releaseSession(socketId);
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
      if (released) await released.cleanup;
      throw err;
    }
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
  private releaseSession(
    socketId: string,
    cleanupDelayMs = 0,
  ): { session: TerminalSession; cleanup: Promise<void> } | undefined {
    const session = this.sessions.get(socketId);
    if (!session) return undefined;
    clearTimeout(session.idleTimer);
    clearTimeout(session.lifetimeTimer);
    for (const disposable of session.disposables) {
      try { disposable.dispose(); } catch { /* already disposed */ }
    }
    this.sessions.delete(socketId);
    const cleanup = this.sandbox.unregister(socketId, cleanupDelayMs).catch((err) => {
      this.logger.warn({ socketId, sandboxDir: session.sandboxDir, err }, 'Terminal sandbox cleanup failed');
    });
    return { session, cleanup };
  }

  killSession(socketId: string): void {
    const pending = this.starting.get(socketId);
    if (pending) pending.cancelled = true;
    const released = this.releaseSession(socketId, KILL_CLEANUP_DELAY_MS);
    if (!released) return;
    const { session } = released;

    try {
      session.pty.kill();
      // Force-kill after 3s if a graceful kill doesn't stop it.
      const child = session.pty;
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, FORCE_KILL_DELAY_MS).unref();
    } catch {
      // Already exited
    }

    this.logger.info({ socketId }, 'Terminal session killed');
  }

  async onModuleDestroy(): Promise<void> {
    for (const attempt of this.starting.values()) attempt.cancelled = true;
    await Promise.allSettled([...this.starting.values()].map(attempt => attempt.promise));
    const cleanups: Promise<void>[] = [];
    for (const socketId of this.sessions.keys()) {
      const released = this.releaseSession(socketId);
      if (!released) continue;
      try { released.session.pty.kill('SIGKILL'); } catch { /* already exited */ }
      cleanups.push(released.cleanup);
    }
    await Promise.all(cleanups);
  }
}
