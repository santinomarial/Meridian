import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import * as os from 'os';
import * as fs from 'fs/promises';
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

  getSandboxDir(workspaceId: string, userId: string): string {
    if (!SAFE_ID_RE.test(workspaceId) || !SAFE_ID_RE.test(userId)) {
      throw new Error('Invalid workspaceId or userId for sandbox path');
    }
    return path.join(this.sandboxBaseDir(), workspaceId, userId);
  }

  /**
   * Creates/reuses the sandbox dir and writes every document in the workspace
   * into it, preserving folder structure. Returns the sandbox root.
   */
  async materialize(workspaceId: string, userId: string): Promise<string> {
    const root = this.getSandboxDir(workspaceId, userId);
    await fs.mkdir(root, { recursive: true });

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
          await fs.writeFile(target, doc.content ?? '', 'utf8');
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
    return root;
  }

  /** Registers an active sandbox so document edits can be synced into it. */
  registerActive(socketId: string, workspaceId: string, userId: string, root: string, socket: Socket): void {
    this.active.set(socketId, { workspaceId, userId, root, socket });
  }

  unregister(socketId: string): void {
    this.active.delete(socketId);
  }

  private sandboxesFor(workspaceId: string): ActiveSandbox[] {
    return [...this.active.values()].filter((s) => s.workspaceId === workspaceId);
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
    for (const sandbox of this.sandboxesFor(workspaceId)) {
      try {
        const target = safeJoin(sandbox.root, relPath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf8');
        sandbox.socket.emit('terminal:sync', { status: 'synced' });
      } catch (err) {
        this.logger.warn({ workspaceId, relPath, err }, 'Sandbox file write sync failed');
        this.warn(sandbox);
      }
    }
  }

  private async applyMkdir(workspaceId: string, relPath: string): Promise<void> {
    for (const sandbox of this.sandboxesFor(workspaceId)) {
      try {
        await fs.mkdir(safeJoin(sandbox.root, relPath), { recursive: true });
        sandbox.socket.emit('terminal:sync', { status: 'synced' });
      } catch (err) {
        this.logger.warn({ workspaceId, relPath, err }, 'Sandbox mkdir sync failed');
        this.warn(sandbox);
      }
    }
  }

  private async applyDelete(workspaceId: string, relPath: string): Promise<void> {
    for (const sandbox of this.sandboxesFor(workspaceId)) {
      try {
        const target = safeJoin(sandbox.root, relPath);
        await fs.rm(target, { recursive: true, force: true });
        sandbox.socket.emit('terminal:sync', { status: 'synced' });
      } catch (err) {
        this.logger.warn({ workspaceId, relPath, err }, 'Sandbox delete sync failed');
        this.warn(sandbox);
      }
    }
  }

  private async applyRename(workspaceId: string, oldPath: string, newPath: string): Promise<void> {
    for (const sandbox of this.sandboxesFor(workspaceId)) {
      try {
        const from = safeJoin(sandbox.root, oldPath);
        const to = safeJoin(sandbox.root, newPath);
        await fs.mkdir(path.dirname(to), { recursive: true });
        // Tolerate a missing source: the destination is what matters.
        await fs.rename(from, to).catch(async () => {
          await fs.mkdir(path.dirname(to), { recursive: true });
        });
        sandbox.socket.emit('terminal:sync', { status: 'synced' });
      } catch (err) {
        this.logger.warn({ workspaceId, oldPath, newPath, err }, 'Sandbox rename sync failed');
        this.warn(sandbox);
      }
    }
  }
}
