import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { DocumentType, Prisma, type Document } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { acquireDocumentLock, encodeSeededState, projectCrdtText } from '../common/crdt/crdt-lineage';
import { TerminalSandboxService } from '../modules/terminal/terminal-sandbox.service';
import { DocumentPersistenceService } from '../modules/realtime/document-persistence.service';
import { DocumentRestoreService } from '../modules/realtime/document-restore.service';
import { assertSafeRelPath } from '../modules/terminal/path-safety';
import { type TerminalFileChange, type TerminalFileResult, TERMINAL_FILE_MAX_BYTES, TERMINAL_TREE_MAX_FILES } from '../modules/terminal/terminal-files';

/** Saves settled terminal text edits through the same durable CRDT fence as restore. */
@Injectable()
export class TerminalFileImportService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sandbox: TerminalSandboxService,
    private readonly persistence: DocumentPersistenceService,
    private readonly restores: DocumentRestoreService,
  ) {}

  onModuleInit(): void {
    this.sandbox.registerFileImporter((...args) => this.importFiles(...args));
  }

  async importFiles(
    workspaceId: string,
    userId: string,
    sessionJti: string | undefined,
    changes: TerminalFileChange[],
  ): Promise<TerminalFileResult[]> {
    if (!sessionJti) throw new ForbiddenException('Terminal session is no longer active');
    if (changes.length > TERMINAL_TREE_MAX_FILES) throw new Error('Too many terminal files');
    for (const change of changes) {
      if (assertSafeRelPath(change.path) !== change.path || change.path.split('/').length > 64 ||
          change.path.split('/').some((part) => Buffer.byteLength(part) > 255) ||
          Buffer.byteLength(change.path) > 4096 || Buffer.byteLength(change.content) > TERMINAL_FILE_MAX_BYTES) {
        throw new Error('Terminal file exceeds workspace limits');
      }
    }
    const existing = await this.prisma.document.findMany({
      where: { workspaceId, path: { in: changes.map((c) => c.path) } }, select: { id: true },
    });
    for (const doc of existing) await this.persistence.flushDocument(doc.id);

    const result = await this.prisma.$transaction(async (tx) => {
      // Serializes imports from multiple local shells; document locks below
      // additionally fence Save, restore, and concurrent realtime persistence.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`terminal:${workspaceId}`}, 0))`;
      const session = await tx.session.findUnique({ where: { jti: sessionJti } });
      const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
      if (!session || session.userId !== userId || session.revokedAt || session.expiresAt <= new Date() ||
          !member || member.role === 'VIEWER') throw new ForbiddenException('Terminal write access has expired');

      const files: TerminalFileResult[] = [];
      const resets: { id: string; generation: number }[] = [];
      const conflicts: string[] = [];
      for (const change of [...changes].sort((a, b) => a.path.localeCompare(b.path))) {
        let current = await tx.document.findUnique({ where: { workspaceId_path: { workspaceId, path: change.path } } });
        let live: string | null = null;
        if (current) {
          await acquireDocumentLock(tx, current.id);
          current = await tx.document.findUnique({ where: { id: current.id } });
          if (current?.type === 'FILE') {
            live = await projectCrdtText(tx, current.id, current.crdtGeneration) ?? current.content ?? '';
          }
        }
        // A delayed retry of an already committed write is idempotent.
        if (current?.type === 'FILE' && current.content === change.content && live === change.content) {
          files.push({ path: current.path, content: change.content });
          resets.push({ id: current.id, generation: current.crdtGeneration });
          continue;
        }
        const conflict = current
          ? current.type !== 'FILE' || change.baseContent === undefined ||
            (current.content ?? '') !== change.baseContent || live !== change.baseContent
          : change.baseContent !== undefined;
        if (conflict) {
          // Preserve both versions durably rather than silently replacing a
          // collaborator's newer saved OR unsaved durable text.
          const name = change.path.split('/').at(-1) ?? 'file.txt';
          const key = createHash('sha256').update(JSON.stringify([change.path, change.baseContent, change.content])).digest('hex').slice(0, 24);
          const copyPath = `terminal-conflicts/${key}-${Buffer.from(name).length > 180 ? 'file.txt' : name}`;
          let copy = await tx.document.findUnique({ where: { workspaceId_path: { workspaceId, path: copyPath } } });
          if (copy && (copy.type !== 'FILE' || copy.content !== change.content)) throw new Error('Conflict recovery path is already occupied');
          if (!copy) {
            copy = await this.createFile(tx, workspaceId, copyPath, change.content);
            await this.version(tx, copy, change.content, userId, `Terminal conflict from ${change.path}`);
          }
          files.push({ path: copy.path, content: change.content, conflictSource: change.path });
          conflicts.push(copy.path);
          if (current?.type === 'FILE') files.push({ path: current.path, content: current.content ?? '' });
          continue;
        }
        if (!current) {
          const created = await this.createFile(tx, workspaceId, change.path, change.content);
          await this.version(tx, created, change.content, userId, 'Created in terminal');
          files.push({ path: created.path, content: change.content });
          continue;
        }
        // Keep the pre-edit checkpoint recoverable even for a never-saved file.
        const latest = await tx.documentVersion.findFirst({ where: { documentId: current.id }, orderBy: { versionNumber: 'desc' } });
        if (latest?.content !== (current.content ?? '')) {
          await this.version(tx, current, current.content ?? '', userId, 'Before terminal edit');
        }
        const generation = current.crdtGeneration + 1;
        await tx.documentUpdate.deleteMany({ where: { documentId: current.id } });
        await tx.snapshot.deleteMany({ where: { documentId: current.id } });
        await tx.snapshot.create({ data: { documentId: current.id, generation, seq: 0,
          state: Buffer.from(encodeSeededState(current.id, generation, change.content)) } });
        const updated = await tx.document.update({ where: { id: current.id }, data: { content: change.content, crdtGeneration: generation } });
        await this.version(tx, updated, change.content, userId, 'Saved from terminal');
        resets.push({ id: current.id, generation });
        files.push({ path: updated.path, content: change.content });
      }
      return { files, resets, conflicts };
    }, { timeout: 60_000 });

    for (const reset of result.resets) await this.restores.applyRestore(reset.id, reset.generation);
    await this.restores.publishWorkspaceFilesChanged(workspaceId, result.conflicts);
    return result.files;
  }

  private async createFile(tx: Prisma.TransactionClient, workspaceId: string, relPath: string, content: string): Promise<Document> {
    const segments = relPath.split('/');
    let parentId: string | null = null;
    for (let i = 0; i < segments.length - 1; i++) {
      const folderPath = segments.slice(0, i + 1).join('/');
      const folder: Document = await tx.document.upsert({
        where: { workspaceId_path: { workspaceId, path: folderPath } }, update: {},
        create: { workspaceId, path: folderPath, name: segments[i]!, type: DocumentType.FOLDER, parentId },
      });
      if (folder.type !== DocumentType.FOLDER) throw new Error(`Parent is not a folder: ${folderPath}`);
      parentId = folder.id;
    }
    return tx.document.create({ data: { workspaceId, parentId, path: relPath,
      name: segments.at(-1)!, type: DocumentType.FILE, content } });
  }

  private async version(tx: Prisma.TransactionClient, doc: Document, content: string, userId: string, message: string): Promise<void> {
    const latest = await tx.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true } });
    await tx.documentVersion.create({ data: { documentId: doc.id, workspaceId: doc.workspaceId,
      content, createdById: userId, message, versionNumber: (latest?.versionNumber ?? 0) + 1 } });
  }
}
