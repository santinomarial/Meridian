import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Document, DocumentVersion, Prisma } from '@prisma/client';
import { DocumentType } from '@prisma/client';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { assertSafeRelPath } from '../modules/terminal/path-safety';

export type { DocumentType };

// First-path-segment prefixes that are runtime/build artifacts, never part of
// a real workspace export even if a document somehow lives under them.
const EXPORT_EXCLUDED_SEGMENTS = new Set(['.meridian-build', '.terminal-sandboxes']);

/** Result of building a workspace export. */
export interface WorkspaceExport {
  buffer: Buffer;
  filename: string;
}

/** True when a (already-normalized) relative path is an excluded artifact. */
export function isExcludedExportPath(relPath: string): boolean {
  const firstSegment = relPath.split('/')[0];
  return firstSegment !== undefined && EXPORT_EXCLUDED_SEGMENTS.has(firstSegment);
}

/**
 * Turns a workspace name into a safe download filename stem (no extension).
 * Strips characters that are unsafe in filenames / Content-Disposition and
 * falls back to "workspace" when nothing usable remains.
 */
export function sanitizeZipFilenameStem(name: string | null | undefined): string {
  const cleaned = (name ?? '')
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100)
    .trim();
  return cleaned.length > 0 ? cleaned : 'workspace';
}

/** Lightweight version metadata returned by the list endpoint. */
export interface VersionListItem {
  id: string;
  versionNumber: number;
  message: string | null;
  createdAt: Date;
  contentLength: number;
  createdBy: { id: string; displayName: string } | null;
}

/** Full version content returned by the detail endpoint. */
export interface VersionDetail extends VersionListItem {
  documentId: string;
  content: string;
}

/** Result of a restore — includes the restored content for realtime sync. */
export interface RestoreResult {
  document: Document;
  restoredFromVersion: number;
  newVersionNumber: number;
  content: string;
}

export interface CreateDocumentData {
  workspaceId: string;
  parentId?: string;
  type: DocumentType;
  path: string;
  name: string;
  language?: string;
  content?: string;
}

export interface UpdateDocumentData {
  name?: string;
  path?: string;
  language?: string | null;
  parentId?: string | null;
}

export interface PatchDocumentData extends UpdateDocumentData {
  content?: string | null;
}

export type DocumentNode = Document & { children: DocumentNode[] };

interface PathChange {
  document: Document;
  path: string;
}

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDocument(data: CreateDocumentData): Promise<Document> {
    const name = this.validateDocumentName(data.name);
    const suppliedPath = this.validateDocumentPath(data.path);
    let parent: Document | null = null;

    if (data.parentId !== undefined) {
      parent = await this.prisma.document.findUnique({
        where: { id: data.parentId },
      });
      this.assertValidParent(parent, data.workspaceId);
    }

    const path = this.buildChildPath(parent, name);
    if (suppliedPath !== path) {
      throw new BadRequestException(
        `Document path must match its parent and name (expected "${path}")`,
      );
    }

    return this.prisma.document.create({
      data: {
        ...data,
        parentId: parent?.id ?? null,
        name,
        path,
      },
    });
  }

  /**
   * Creates many documents in one transaction (used by ZIP import).
   * Parents are resolved from each document's path, so folders must be
   * resolvable before their contents — the input is depth-sorted to ensure
   * that. Documents whose path already exists in the workspace are reused;
   * existing files get their content refreshed instead of failing the import.
   */
  async bulkCreateDocuments(
    workspaceId: string,
    documents: Omit<CreateDocumentData, 'workspaceId'>[],
  ): Promise<Document[]> {
    const normalized = documents.map((input) => {
      const path = this.validateDocumentPath(input.path);
      const name = this.validateDocumentName(input.name);
      if (path.split('/').at(-1) !== name) {
        throw new BadRequestException(
          `Document name must match the final path segment for "${path}"`,
        );
      }
      return { ...input, path, name };
    });
    const segmentCount = (path: string): number => path.split('/').length;
    const sorted = [...normalized].sort(
      (a, b) => segmentCount(a.path) - segmentCount(b.path) || a.path.localeCompare(b.path),
    );

    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const documentByPath = new Map<string, Document>();
        const results: Document[] = [];

        for (const input of sorted) {
          const slashIdx = input.path.lastIndexOf('/');
          const parentPath = slashIdx > 0 ? input.path.slice(0, slashIdx) : null;
          let parent: Document | null = null;
          if (parentPath !== null) {
            parent = documentByPath.get(parentPath) ?? null;
            if (parent === null) {
              parent = await tx.document.findUnique({
                where: { workspaceId_path: { workspaceId, path: parentPath } },
              });
            }
            if (parent === null) {
              throw new BadRequestException(
                `Parent folder "${parentPath}" must exist before "${input.path}"`,
              );
            }
            this.assertValidParent(parent, workspaceId);
          }

          const existing = await tx.document.findUnique({
            where: { workspaceId_path: { workspaceId, path: input.path } },
          });

          let doc: Document;
          if (existing !== null) {
            if (existing.type !== input.type) {
              throw new ConflictException(
                `Cannot import ${input.type.toLowerCase()} "${input.path}" over an existing ${existing.type.toLowerCase()}`,
              );
            }
            doc = await tx.document.update({
              where: { id: existing.id },
              data: {
                parentId: parent?.id ?? null,
                name: input.name,
                ...(input.type === DocumentType.FILE
                  ? {
                      content: input.content ?? existing.content,
                      language: input.language ?? existing.language,
                    }
                  : {}),
              },
            });
          } else {
            doc = await tx.document.create({
              data: {
                workspaceId,
                parentId: parent?.id ?? null,
                type: input.type,
                path: input.path,
                name: input.name,
                language: input.language,
                content: input.content,
              },
            });
          }

          documentByPath.set(input.path, doc);
          results.push(doc);
        }

        return results;
      },
      { timeout: 60_000 },
    );
  }

  async findById(documentId: string): Promise<Document | null> {
    return this.prisma.document.findUnique({ where: { id: documentId } });
  }

  async listForWorkspace(workspaceId: string): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { workspaceId },
      orderBy: { path: 'asc' },
    });
  }

  /**
   * Builds a ZIP of a workspace from the database (the source of truth):
   * every folder/file document, with its latest saved content and preserved
   * structure. Runtime/build artifacts (e.g. `.meridian-build/`) are excluded,
   * and the terminal sandbox is never touched (it isn't DB-backed).
   *
   * Path safety: each document path is normalized to a POSIX relative path and
   * rejected if it is absolute, contains `..`, or has control characters —
   * such documents are skipped rather than allowed to escape the archive.
   *
   * Limitation: the archive is assembled in memory before sending. That is fine
   * at Meridian's current scale (per-file content is small and capped); a very
   * large workspace would warrant a streaming archiver instead.
   */
  async exportWorkspaceZip(workspaceId: string): Promise<WorkspaceExport> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    });

    const docs = await this.prisma.document.findMany({
      where: { workspaceId },
      orderBy: { path: 'asc' },
      select: { type: true, path: true, content: true },
    });

    const zip = new JSZip();
    const seenFiles = new Set<string>();

    for (const doc of docs) {
      let relPath: string;
      try {
        relPath = assertSafeRelPath(doc.path);
      } catch {
        // Skip any document whose path is unsafe rather than risk traversal.
        continue;
      }
      if (isExcludedExportPath(relPath)) continue;

      if (doc.type === DocumentType.FOLDER) {
        // Preserve (possibly empty) folders.
        zip.folder(relPath);
      } else {
        if (seenFiles.has(relPath)) continue; // first writer wins; no clobber
        seenFiles.add(relPath);
        zip.file(relPath, doc.content ?? '');
      }
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    return {
      buffer,
      filename: `${sanitizeZipFilenameStem(workspace?.name)}.zip`,
    };
  }

  async getTree(workspaceId: string): Promise<DocumentNode[]> {
    const docs = await this.prisma.document.findMany({
      where: { workspaceId },
      orderBy: { path: 'asc' },
    });

    const nodeMap = new Map<string, DocumentNode>(
      docs.map((doc) => [doc.id, { ...doc, children: [] }]),
    );

    const roots: DocumentNode[] = [];

    for (const node of nodeMap.values()) {
      if (node.parentId !== null) {
        const parent = nodeMap.get(node.parentId);
        if (parent !== undefined) {
          parent.children.push(node);
          continue;
        }
      }
      roots.push(node);
    }

    return roots;
  }

  async updateContent(documentId: string, content: string): Promise<Document> {
    return this.prisma.document.update({
      where: { id: documentId },
      data: { content },
    });
  }

  async updateMetadata(
    documentId: string,
    data: UpdateDocumentData,
  ): Promise<Document> {
    return this.patchDocument(documentId, data);
  }

  /**
   * Updates a document and, when the content meaningfully changes, records a
   * new DocumentVersion in the same transaction so the update and the version
   * either both commit or both roll back.
   *
   * A version is created only when `content` is provided AND differs from the
   * currently-persisted content — identical saves (e.g. a Cmd+S with no edits,
   * or a metadata-only rename) never produce duplicate versions.  The first
   * meaningful save naturally becomes versionNumber 1, so no separate "initial
   * version" bookkeeping is needed.
   */
  async patchDocument(
    documentId: string,
    data: PatchDocumentData,
    userId?: string,
  ): Promise<Document> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.document.findUnique({
        where: { id: documentId },
      });
      if (current === null) {
        throw new NotFoundException(`Document ${documentId} not found`);
      }

      const hierarchyChanged =
        data.name !== undefined ||
        data.path !== undefined ||
        data.parentId !== undefined;
      let updateData: PatchDocumentData = { ...data };
      let descendantChanges: PathChange[] = [];

      if (hierarchyChanged) {
        const allDocuments = await tx.document.findMany({
          where: { workspaceId: current.workspaceId },
        });
        const byId = new Map(allDocuments.map((document) => [document.id, document]));
        byId.set(current.id, current);

        const nextParentId =
          data.parentId !== undefined ? data.parentId : current.parentId;
        let nextParent: Document | null = null;
        if (nextParentId !== null) {
          if (nextParentId === current.id) {
            throw new BadRequestException('A document cannot be its own parent');
          }
          nextParent = byId.get(nextParentId) ?? null;
          this.assertValidParent(nextParent, current.workspaceId);
          this.assertParentIsNotDescendant(current.id, nextParent, byId);
        }

        const suppliedPath =
          data.path !== undefined ? this.validateDocumentPath(data.path) : undefined;
        const name = this.validateDocumentName(
          data.name ?? suppliedPath?.split('/').at(-1) ?? current.name,
        );
        const path = this.buildChildPath(nextParent, name);

        // The web client historically sends a leaf path on rename. Accept that
        // representation, but never accept a conflicting directory prefix.
        if (
          suppliedPath !== undefined &&
          suppliedPath !== name &&
          suppliedPath !== path
        ) {
          throw new BadRequestException(
            `Document path must match its parent and name (expected "${path}")`,
          );
        }

        updateData = {
          ...data,
          parentId: nextParent?.id ?? null,
          name,
          path,
        };

        if (current.type === DocumentType.FOLDER && path !== current.path) {
          descendantChanges = this.buildDescendantPathChanges(
            current,
            path,
            allDocuments,
          );
        }

        const changes: PathChange[] = [
          { document: current, path },
          ...descendantChanges,
        ];
        this.assertNoPathCollisions(changes, allDocuments);

        // A final path can overlap another moved node's old path. Move every
        // changed node to a transaction-local temporary path first so the
        // workspace/path unique constraint never observes an intermediate
        // collision.
        const changedPaths = changes.filter(
          (change) => change.document.path !== change.path,
        );
        if (changedPaths.length > 1) {
          const occupied = new Set(allDocuments.map((document) => document.path));
          for (const [index, change] of changedPaths.entries()) {
            let temporaryPath = `.__meridian_move__/${documentId}/${index}`;
            while (occupied.has(temporaryPath)) temporaryPath += '_';
            occupied.add(temporaryPath);
            await tx.document.update({
              where: { id: change.document.id },
              data: { path: temporaryPath },
            });
          }
        }
      }

      const updated = await tx.document.update({
        where: { id: documentId },
        data: updateData,
      });

      for (const change of descendantChanges) {
        if (change.document.path === change.path) continue;
        await tx.document.update({
          where: { id: change.document.id },
          data: { path: change.path },
        });
      }

      const contentChanged =
        data.content !== undefined &&
        data.content !== null &&
        data.content !== current.content;

      if (contentChanged) {
        await this.createVersionTx(tx, {
          documentId,
          workspaceId: current.workspaceId,
          content: data.content as string,
          createdById: userId ?? null,
        });
      }

      return updated;
    });
  }

  private validateDocumentName(name: string): string {
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      throw new BadRequestException('Document name must be a single safe path segment');
    }
    let normalized: string;
    try {
      normalized = assertSafeRelPath(name);
    } catch {
      throw new BadRequestException('Document name must be a single safe path segment');
    }
    if (normalized !== name) {
      throw new BadRequestException('Document name must be a single safe path segment');
    }
    return name;
  }

  private validateDocumentPath(path: string): string {
    if (path.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')) {
      throw new BadRequestException('Document path contains an unsafe segment');
    }
    try {
      return assertSafeRelPath(path);
    } catch {
      throw new BadRequestException('Document path is invalid');
    }
  }

  private assertValidParent(
    parent: Document | null,
    workspaceId: string,
  ): asserts parent is Document {
    if (parent === null || parent.workspaceId !== workspaceId) {
      throw new BadRequestException(
        'Parent document must exist in the same workspace',
      );
    }
    if (parent.type !== DocumentType.FOLDER) {
      throw new BadRequestException('Parent document must be a folder');
    }
  }

  private buildChildPath(parent: Document | null, name: string): string {
    if (parent === null) return name;
    const parentPath = this.validateDocumentPath(parent.path);
    if (parentPath !== parent.path) {
      throw new BadRequestException('Parent document has an invalid path');
    }
    return `${parentPath}/${name}`;
  }

  private assertParentIsNotDescendant(
    documentId: string,
    parent: Document,
    byId: Map<string, Document>,
  ): void {
    const visited = new Set<string>();
    let cursor: Document | undefined = parent;
    while (cursor !== undefined) {
      if (cursor.id === documentId) {
        throw new BadRequestException('A folder cannot be moved into its descendant');
      }
      if (visited.has(cursor.id)) {
        throw new BadRequestException('Document hierarchy contains a cycle');
      }
      visited.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
  }

  private buildDescendantPathChanges(
    root: Document,
    rootPath: string,
    documents: Document[],
  ): PathChange[] {
    const childrenByParent = new Map<string, Document[]>();
    for (const document of documents) {
      if (document.parentId === null) continue;
      const children = childrenByParent.get(document.parentId) ?? [];
      children.push(document);
      childrenByParent.set(document.parentId, children);
    }

    const changes: PathChange[] = [];
    const visited = new Set<string>([root.id]);
    const queue = (childrenByParent.get(root.id) ?? []).map((document) => ({
      document,
      parentPath: rootPath,
    }));
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (visited.has(next.document.id)) {
        throw new BadRequestException('Document hierarchy contains a cycle');
      }
      visited.add(next.document.id);
      const name = this.validateDocumentName(next.document.name);
      const path = `${next.parentPath}/${name}`;
      changes.push({ document: next.document, path });
      for (const child of childrenByParent.get(next.document.id) ?? []) {
        queue.push({ document: child, parentPath: path });
      }
    }
    return changes;
  }

  private assertNoPathCollisions(
    changes: PathChange[],
    documents: Document[],
  ): void {
    const movedIds = new Set(changes.map((change) => change.document.id));
    const occupied = new Set(
      documents
        .filter((document) => !movedIds.has(document.id))
        .map((document) => document.path),
    );
    const proposed = new Set<string>();
    for (const change of changes) {
      if (occupied.has(change.path) || proposed.has(change.path)) {
        throw new ConflictException(
          `A document already exists at path "${change.path}"`,
        );
      }
      proposed.add(change.path);
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.prisma.document.delete({ where: { id: documentId } });
  }

  // ---------------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------------

  /** Lists a document's versions, newest first, without full content payloads. */
  async listVersions(documentId: string): Promise<VersionListItem[]> {
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        message: true,
        createdAt: true,
        content: true,
        createdBy: { select: { id: true, displayName: true } },
      },
    });

    return versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      message: v.message,
      createdAt: v.createdAt,
      contentLength: v.content.length,
      createdBy: v.createdBy,
    }));
  }

  /** Returns a single version with full content, scoped to the document. */
  async getVersion(
    documentId: string,
    versionId: string,
  ): Promise<VersionDetail> {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: { createdBy: { select: { id: true, displayName: true } } },
    });
    // Treat a missing version and a version belonging to a different document
    // identically (404) so version ids are not cross-document enumerable.
    if (version === null || version.documentId !== documentId) {
      throw new NotFoundException(
        `Version ${versionId} not found for document ${documentId}`,
      );
    }
    return {
      id: version.id,
      documentId: version.documentId,
      versionNumber: version.versionNumber,
      message: version.message,
      createdAt: version.createdAt,
      content: version.content,
      contentLength: version.content.length,
      createdBy: version.createdBy,
    };
  }

  /**
   * Restores a document to a previous version's content.
   *
   * In one transaction: rewrites the document content and records a new
   * version capturing the restored content with a "Restored from version X"
   * message.  The realtime reconciliation (live Y.Doc + broadcast) is handled
   * by the caller via DocumentRestoreService, after this transaction commits.
   */
  async restoreVersion(
    documentId: string,
    versionId: string,
    userId?: string,
  ): Promise<RestoreResult> {
    // Validate the version belongs to this document before opening the
    // transaction so a mismatch returns a clean 404.
    const source = await this.findVersionForDocument(documentId, versionId);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const document = await tx.document.update({
        where: { id: documentId },
        data: { content: source.content },
      });

      const newVersion = await this.createVersionTx(tx, {
        documentId,
        workspaceId: source.workspaceId,
        content: source.content,
        createdById: userId ?? null,
        message: `Restored from version ${source.versionNumber}`,
      });

      return {
        document,
        restoredFromVersion: source.versionNumber,
        newVersionNumber: newVersion.versionNumber,
        content: source.content,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Version helpers
  // ---------------------------------------------------------------------------

  private async findVersionForDocument(
    documentId: string,
    versionId: string,
  ): Promise<DocumentVersion> {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
    });
    // Treat a missing version and a version belonging to a different document
    // identically (404) so version ids are not cross-document enumerable.
    if (version === null || version.documentId !== documentId) {
      throw new NotFoundException(
        `Version ${versionId} not found for document ${documentId}`,
      );
    }
    return version;
  }

  /**
   * Creates the next version for a document inside an existing transaction.
   * versionNumber is derived from the current max for the document, so numbers
   * increment per-document and the @@unique([documentId, versionNumber])
   * constraint rejects any concurrent duplicate.
   */
  private async createVersionTx(
    tx: Prisma.TransactionClient,
    params: {
      documentId: string;
      workspaceId: string;
      content: string;
      createdById: string | null;
      message?: string;
    },
  ): Promise<DocumentVersion> {
    const last = await tx.documentVersion.findFirst({
      where: { documentId: params.documentId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (last?.versionNumber ?? 0) + 1;

    return tx.documentVersion.create({
      data: {
        documentId: params.documentId,
        workspaceId: params.workspaceId,
        createdById: params.createdById,
        versionNumber,
        content: params.content,
        message: params.message ?? null,
      },
    });
  }
}
