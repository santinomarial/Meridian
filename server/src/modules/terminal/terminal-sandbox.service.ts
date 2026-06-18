import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DocumentType } from '@prisma/client';
import type { Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSafeRelPath, safeJoin } from './path-safety';

// Allowed characters in workspace/user ids used as path segments.
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

interface ActiveSandbox {
  workspaceId: string;
  userId: string;
  root: string;
  socket: Socket;
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
 * Sandboxes live under the OS temp dir (not the server project tree) so the
 * shell's working directory is well away from server source and secrets. This
 * is NOT container isolation — see the README's "known limitations".
 */
@Injectable()
export class TerminalSandboxService {
  // socketId → active sandbox (one terminal session per socket).
  private readonly active = new Map<string, ActiveSandbox>();

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(TerminalSandboxService.name)
    private readonly logger: PinoLogger,
  ) {}

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
  // Live sync — best-effort projections of DB mutations. All no-op when no
  // terminal sandbox is active for the workspace.
  // ---------------------------------------------------------------------------

  async syncWriteFile(workspaceId: string, relPath: string, content: string): Promise<void> {
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

  async syncMkdir(workspaceId: string, relPath: string): Promise<void> {
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

  async syncDelete(workspaceId: string, relPath: string): Promise<void> {
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

  async syncRename(workspaceId: string, oldPath: string, newPath: string): Promise<void> {
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

  /** Validates that a relative path is safe (used by run-file before exec). */
  assertSafe(relPath: string): string {
    return assertSafeRelPath(relPath);
  }
}
