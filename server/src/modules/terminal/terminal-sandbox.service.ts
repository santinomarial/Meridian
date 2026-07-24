import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import * as os from 'os';
import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';
import { DocumentType } from '@prisma/client';
import type { Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { assertSafeRelPath, safeJoin } from './path-safety';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

// Allowed characters in workspace/user ids used as path segments.
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Unique per server process — used to ignore a sandbox-sync message this
// instance itself published (it already applied the change locally).
const ORIGIN_ID = randomUUID();

// Redis pub/sub channels for cross-instance sandbox sync.
const SANDBOX_SYNC_PATTERN = 'meridian:sandbox:*:sync';
function sandboxChannel(workspaceId: string): string {
  return `meridian:sandbox:${workspaceId}:sync`;
}

interface ActiveSandbox {
  workspaceId: string;
  userId: string;
  root: string;
  socket: Socket;
}

type SandboxLease = Omit<ActiveSandbox, 'socket'>;

type SandboxOp = 'write' | 'mkdir' | 'delete' | 'rename';

interface SandboxSyncMessage {
  originId: string;
  op: SandboxOp;
  workspaceId: string;
  relPath?: string;
  content?: string;
  oldPath?: string;
  newPath?: string;
}

/**
 * Materializes a workspace's DB-backed documents into an on-disk sandbox so the
 * terminal can run them, and keeps that sandbox in sync as documents change.
 *
 * THE DATABASE IS THE SOURCE OF TRUTH. The sandbox is a disposable runtime
 * projection of the workspace used only for terminal execution. Sync is
 * best-effort: a failed sync warns the user (in the terminal and via a
 * `terminal:sync` event) but never throws into — or corrupts — the DB path.
 *
 * Cross-instance: a PTY (and its sandbox dir) lives on one server instance, but
 * a document edit can be handled by any instance. So each sync op is applied to
 * local sandboxes AND published over Redis; the instance hosting the sandbox
 * applies the change to disk. The op carries the new content so the receiving
 * instance doesn't need a DB read. See docs/scaling.md. This fan-out only runs
 * when the terminal feature is enabled (otherwise no sandboxes exist anywhere).
 *
 * Sandboxes live under the OS temp dir (not the server project tree). This is
 * NOT container isolation — see the README's "known limitations".
 */
@Injectable()
export class TerminalSandboxService implements OnModuleInit {
  // socketId → active sandbox (one terminal session per socket).
  private readonly active = new Map<string, ActiveSandbox>();
  // A reservation spans materialization through PTY spawn/registration. It
  // prevents teardown from deleting a root during that asynchronous gap.
  private readonly reservations = new Map<string, SandboxLease>();
  private readonly preparations = new Map<string, Promise<void>>();
  private readonly rootOperations = new Map<string, Promise<unknown>>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();
  private readonly enableTerminal: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    configService: ConfigService,
    @InjectPinoLogger(TerminalSandboxService.name)
    private readonly logger: PinoLogger,
  ) {
    this.enableTerminal = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY).enableTerminal;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enableTerminal) return;
    await this.redis.subscribe(SANDBOX_SYNC_PATTERN, (_channel, message) =>
      this.onRemoteSync(message),
    );
  }

  sandboxBaseDir(): string {
    return path.join(os.tmpdir(), 'meridian-terminal-sandboxes');
  }

  activeCount(): number {
    return this.active.size;
  }

  getSandboxDir(workspaceId: string, userId: string): string {
    if (!SAFE_ID_RE.test(workspaceId) || !SAFE_ID_RE.test(userId)) {
      throw new Error('Invalid workspaceId or userId for sandbox path');
    }
    return path.join(this.sandboxBaseDir(), workspaceId, userId);
  }

  /**
   * Rebuilds the sandbox dir and writes every document in the workspace into
   * it, preserving folder structure. A socket reservation protects the root
   * until registerActive consumes it. Concurrent sessions sharing the same
   * workspace/user root await one materialization instead of deleting each
   * other's live projection.
   */
  async materialize(socketId: string, workspaceId: string, userId: string): Promise<string> {
    const root = this.getSandboxDir(workspaceId, userId);
    if (this.active.has(socketId) || this.reservations.has(socketId)) {
      throw new Error(`Terminal sandbox already reserved for socket ${socketId}`);
    }

    const lease = { workspaceId, userId, root };
    this.reservations.set(socketId, lease);
    this.cancelCleanup(root);

    let preparation = this.preparations.get(root);
    if (!preparation && !this.hasActiveRoot(root)) {
      preparation = this.runRootOperation(root, () =>
        this.materializeRoot(root, workspaceId, userId),
      );
      this.preparations.set(root, preparation);
      const forgetPreparation = (): void => {
        if (this.preparations.get(root) === preparation) {
          this.preparations.delete(root);
        }
      };
      void preparation.then(forgetPreparation, forgetPreparation);
    }

    try {
      if (preparation) await preparation;
      return root;
    } catch (err) {
      if (this.reservations.get(socketId) === lease) {
        this.reservations.delete(socketId);
      }
      await this.cleanupRoot(root);
      throw err;
    }
  }

  private async materializeRoot(
    root: string,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    await this.recreateSandboxRoot(root);

    const docs = await this.prisma.document.findMany({
      where: { workspaceId },
      orderBy: { path: 'asc' },
      select: { type: true, path: true, content: true },
    });

    for (const doc of docs) {
      try {
        if (doc.type === DocumentType.FOLDER) {
          await fs.mkdir(safeJoin(root, doc.path), { recursive: true });
        } else {
          const target = safeJoin(root, doc.path);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await this.writeFileNoFollow(target, doc.content ?? '');
        }
      } catch (err) {
        // Skip any single unsafe/oddly-named document rather than failing the
        // whole materialization — the rest of the workspace still works.
        this.logger.warn(
          { workspaceId, docPath: doc.path, err },
          'Skipped materializing a document with an unsafe path',
        );
      }
    }

    this.logger.info({ workspaceId, userId, root, count: docs.length }, 'Sandbox materialized');
  }

  /**
   * Removes the previous disposable projection before recreating it. The base
   * and workspace directories must be real directories: accepting a symlink
   * at either level would let mkdir materialize a workspace outside the temp
   * sandbox tree. fs.rm removes a root symlink itself rather than traversing it.
   */
  private async recreateSandboxRoot(root: string): Promise<void> {
    const base = path.resolve(this.sandboxBaseDir());
    const workspaceRoot = path.dirname(root);

    await this.ensureRealDirectory(base);
    await this.ensureRealDirectory(workspaceRoot);
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { mode: 0o700 });

    const [realWorkspaceRoot, realRoot] = await Promise.all([
      fs.realpath(workspaceRoot),
      fs.realpath(root),
    ]);
    if (path.dirname(realRoot) !== realWorkspaceRoot) {
      await fs.rm(root, { recursive: true, force: true });
      throw new Error('Invalid sandbox root: escapes the workspace sandbox directory');
    }
  }

  private async ensureRealDirectory(dir: string): Promise<void> {
    try {
      const stat = await fs.lstat(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Invalid sandbox directory: ${dir}`);
      }
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    try {
      await fs.mkdir(dir, { mode: 0o700 });
    } catch (err) {
      // Another materialization may have created the shared base/workspace dir.
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Invalid sandbox directory: ${dir}`);
    }
  }

  /** Opens the destination atomically without following a final symlink. */
  private async writeFileNoFollow(target: string, content: string): Promise<void> {
    const handle = await fs.open(
      target,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_TRUNC |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(content, 'utf8');
    } finally {
      await handle.close();
    }
  }

  /** Registers an active sandbox so document edits can be synced into it. */
  registerActive(socketId: string, workspaceId: string, userId: string, root: string, socket: Socket): void {
    const reservation = this.reservations.get(socketId);
    if (
      !reservation ||
      reservation.workspaceId !== workspaceId ||
      reservation.userId !== userId ||
      reservation.root !== root
    ) {
      throw new Error(`Terminal sandbox is not reserved for socket ${socketId}`);
    }
    this.reservations.delete(socketId);
    this.cancelCleanup(root);
    this.active.set(socketId, { workspaceId, userId, root, socket });
  }

  async unregister(socketId: string, cleanupDelayMs = 0): Promise<void> {
    const lease = this.active.get(socketId) ?? this.reservations.get(socketId);
    this.active.delete(socketId);
    this.reservations.delete(socketId);
    if (!lease || this.hasRootLease(lease.root)) return;

    if (cleanupDelayMs > 0) {
      this.scheduleCleanup(lease.root, cleanupDelayMs);
      return;
    }
    await this.cleanupRoot(lease.root);
  }

  private sandboxesFor(workspaceId: string): ActiveSandbox[] {
    return [...this.active.values()].filter((s) => s.workspaceId === workspaceId);
  }

  private sandboxRootsFor(workspaceId: string): string[] {
    return [...new Set(this.sandboxesFor(workspaceId).map((sandbox) => sandbox.root))];
  }

  private sandboxesAtRoot(workspaceId: string, root: string): ActiveSandbox[] {
    return this.sandboxesFor(workspaceId).filter((sandbox) => sandbox.root === root);
  }

  private hasActiveRoot(root: string): boolean {
    return [...this.active.values()].some((sandbox) => sandbox.root === root);
  }

  private hasRootLease(root: string): boolean {
    return (
      this.hasActiveRoot(root) ||
      [...this.reservations.values()].some((reservation) => reservation.root === root)
    );
  }

  private runRootOperation<T>(root: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.rootOperations.get(root) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.rootOperations.set(root, current);

    const forgetOperation = (): void => {
      if (this.rootOperations.get(root) === current) {
        this.rootOperations.delete(root);
      }
    };
    void current.then(forgetOperation, forgetOperation);
    return current;
  }

  private cancelCleanup(root: string): void {
    const timer = this.cleanupTimers.get(root);
    if (!timer) return;
    clearTimeout(timer);
    this.cleanupTimers.delete(root);
  }

  private scheduleCleanup(root: string, delayMs: number): void {
    this.cancelCleanup(root);
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(root);
      void this.cleanupRoot(root).catch((err) => {
        this.logger.warn({ root, err }, 'Terminal sandbox cleanup failed');
      });
    }, delayMs);
    timer.unref();
    this.cleanupTimers.set(root, timer);
  }

  private async cleanupRoot(root: string): Promise<void> {
    await this.runRootOperation(root, async () => {
      // A new session may have reserved the root while cleanup was queued.
      if (this.hasRootLease(root)) return;
      await fs.rm(root, { recursive: true, force: true });
      this.logger.info({ root }, 'Terminal sandbox removed');
    });
  }

  private warn(sandbox: ActiveSandbox): void {
    sandbox.socket.emit('terminal:sync', { status: 'failed' });
    sandbox.socket.emit('terminal:output', {
      data: '\r\n\x1b[33m[Meridian] Could not sync workspace file to terminal sandbox.\x1b[0m\r\n',
    });
  }

  // ---------------------------------------------------------------------------
  // Public sync API — apply to local sandboxes AND fan out to other instances.
  // Each is a no-op for instances with no sandbox for the workspace.
  // ---------------------------------------------------------------------------

  async syncWriteFile(workspaceId: string, relPath: string, content: string): Promise<void> {
    await this.applyWriteFile(workspaceId, relPath, content);
    this.publish({ originId: ORIGIN_ID, op: 'write', workspaceId, relPath, content });
  }

  async syncMkdir(workspaceId: string, relPath: string): Promise<void> {
    await this.applyMkdir(workspaceId, relPath);
    this.publish({ originId: ORIGIN_ID, op: 'mkdir', workspaceId, relPath });
  }

  async syncDelete(workspaceId: string, relPath: string): Promise<void> {
    await this.applyDelete(workspaceId, relPath);
    this.publish({ originId: ORIGIN_ID, op: 'delete', workspaceId, relPath });
  }

  async syncRename(workspaceId: string, oldPath: string, newPath: string): Promise<void> {
    await this.applyRename(workspaceId, oldPath, newPath);
    this.publish({ originId: ORIGIN_ID, op: 'rename', workspaceId, oldPath, newPath });
  }

  /** Validates that a relative path is safe (used by run-file before exec). */
  assertSafe(relPath: string): string {
    return assertSafeRelPath(relPath);
  }

  // ---------------------------------------------------------------------------
  // Cross-instance fan-out
  // ---------------------------------------------------------------------------

  private publish(message: SandboxSyncMessage): void {
    if (!this.enableTerminal) return;
    void this.redis.publish(sandboxChannel(message.workspaceId), JSON.stringify(message));
  }

  private onRemoteSync(raw: string | Buffer): void {
    let msg: SandboxSyncMessage;
    try {
      msg = JSON.parse(raw.toString()) as SandboxSyncMessage;
    } catch {
      this.logger.warn('Received malformed sandbox sync message');
      return;
    }
    // Ignore our own broadcast — we already applied it locally.
    if (msg.originId === ORIGIN_ID) return;
    // Only do work when this instance actually hosts a sandbox for the workspace.
    if (this.sandboxesFor(msg.workspaceId).length === 0) return;

    void (async () => {
      try {
        switch (msg.op) {
          case 'write':
            await this.applyWriteFile(msg.workspaceId, msg.relPath ?? '', msg.content ?? '');
            break;
          case 'mkdir':
            await this.applyMkdir(msg.workspaceId, msg.relPath ?? '');
            break;
          case 'delete':
            await this.applyDelete(msg.workspaceId, msg.relPath ?? '');
            break;
          case 'rename':
            await this.applyRename(msg.workspaceId, msg.oldPath ?? '', msg.newPath ?? '');
            break;
        }
      } catch (err) {
        this.logger.warn({ err, op: msg.op }, 'Failed to apply remote sandbox sync');
      }
    })();
  }

  // ---------------------------------------------------------------------------
  // Local filesystem application — shared by the public API and the Redis
  // handler. All no-op when no sandbox is active for the workspace here.
  // ---------------------------------------------------------------------------

  private async applyWriteFile(workspaceId: string, relPath: string, content: string): Promise<void> {
    for (const root of this.sandboxRootsFor(workspaceId)) {
      try {
        const applied = await this.runRootOperation(root, async () => {
          if (!this.hasRootLease(root)) return false;
          const target = safeJoin(root, relPath);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await this.writeFileNoFollow(target, content);
          return true;
        });
        if (applied) {
          for (const sandbox of this.sandboxesAtRoot(workspaceId, root)) {
            sandbox.socket.emit('terminal:sync', { status: 'synced' });
          }
        }
      } catch (err) {
        this.logger.warn({ workspaceId, relPath, err }, 'Sandbox file write sync failed');
        for (const sandbox of this.sandboxesAtRoot(workspaceId, root)) {
          this.warn(sandbox);
        }
      }
    }
  }

  private async applyMkdir(workspaceId: string, relPath: string): Promise<void> {
    for (const root of this.sandboxRootsFor(workspaceId)) {
      try {
        const applied = await this.runRootOperation(root, async () => {
          if (!this.hasRootLease(root)) return false;
          await fs.mkdir(safeJoin(root, relPath), { recursive: true });
          return true;
        });
        if (applied) {
          for (const sandbox of this.sandboxesAtRoot(workspaceId, root)) {
            sandbox.socket.emit('terminal:sync', { status: 'synced' });
          }
        }
      } catch (err) {
        this.logger.warn({ workspaceId, relPath, err }, 'Sandbox mkdir sync failed');
        for (const sandbox of this.sandboxesAtRoot(workspaceId, root)) {
          this.warn(sandbox);
        }
      }
    }
  }

  private async applyDelete(workspaceId: string, relPath: string): Promise<void> {
    for (const root of this.sandboxRootsFor(workspaceId)) {
      try {
        const applied = await this.runRootOperation(root, async () => {
          if (!this.hasRootLease(root)) return false;
          const target = safeJoin(root, relPath);
          await fs.rm(target, { recursive: true, force: true });
          return true;
        });
        if (applied) {
          for (const sandbox of this.sandboxesAtRoot(workspaceId, root)) {
            sandbox.socket.emit('terminal:sync', { status: 'synced' });
          }
        }
      } catch (err) {
        this.logger.warn({ workspaceId, relPath, err }, 'Sandbox delete sync failed');
        for (const sandbox of this.sandboxesAtRoot(workspaceId, root)) {
          this.warn(sandbox);
        }
      }
    }
  }

  private async applyRename(workspaceId: string, oldPath: string, newPath: string): Promise<void> {
    for (const root of this.sandboxRootsFor(workspaceId)) {
      try {
        const applied = await this.runRootOperation(root, async () => {
          if (!this.hasRootLease(root)) return false;
          const from = safeJoin(root, oldPath);
          const to = safeJoin(root, newPath);
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.rename(from, to);
          return true;
        });
        if (applied) {
          for (const sandbox of this.sandboxesAtRoot(workspaceId, root)) {
            sandbox.socket.emit('terminal:sync', { status: 'synced' });
          }
        }
      } catch (err) {
        this.logger.warn({ workspaceId, oldPath, newPath, err }, 'Sandbox rename sync failed');
        for (const sandbox of this.sandboxesAtRoot(workspaceId, root)) {
          this.warn(sandbox);
        }
      }
    }
  }
}
