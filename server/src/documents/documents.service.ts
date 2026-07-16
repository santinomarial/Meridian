import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Document, DocumentVersion } from '@prisma/client';
import { DocumentType, Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { assertSafeRelPath } from '../modules/terminal/path-safety';
import {
  acquireDocumentLock,
  encodeSeededState,
} from '../common/crdt/crdt-lineage';

export type { DocumentType };

// First-path-segment prefixes that are runtime/build artifacts, never part of
// a real workspace export even if a document somehow lives under them.
const EXPORT_EXCLUDED_SEGMENTS = new Set(['.meridian-build', '.terminal-sandboxes']);

export const BULK_IMPORT_MAX_FILES = 1_000;
export const BULK_IMPORT_MAX_DOCUMENTS = 2_000;
export const BULK_IMPORT_MAX_CONTENT_BYTES = 1024 * 1024;
export const BULK_IMPORT_MAX_TOTAL_CONTENT_BYTES = 25 * 1024 * 1024;
export const DOCUMENT_MAX_PATH_BYTES = 4096;
export const DOCUMENT_MAX_SEGMENT_BYTES = 255;
export const DOCUMENT_MAX_DEPTH = 64;
export const WORKSPACE_EXPORT_MAX_DOCUMENTS = BULK_IMPORT_MAX_DOCUMENTS;
export const WORKSPACE_EXPORT_MAX_FILES = BULK_IMPORT_MAX_FILES;
export const WORKSPACE_EXPORT_MAX_CONTENT_BYTES = BULK_IMPORT_MAX_TOTAL_CONTENT_BYTES;
export const WORKSPACE_EXPORT_MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

interface WorkspaceExportMetrics {
  documentCount: bigint;
  fileCount: bigint;
  contentBytes: bigint;
}

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
  /** The new CRDT generation created by the restore. */
  generation: number;
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
    this.assertDocumentContentLimit(data.content, suppliedPath);
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
    this.assertBulkImportLimits(documents);
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
   * The archive is assembled in memory, so a database preflight and a second
   * check over the fetched rows bound document count, file count, source bytes,
   * and final archive bytes before the response is returned.
  */
  async exportWorkspaceZip(workspaceId: string): Promise<WorkspaceExport> {
    const { workspace, docs } = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const workspace = await tx.workspace.findUnique({
          where: { id: workspaceId },
          select: { name: true },
        });

        // Reject oversized workspaces before loading document content into the
        // Node.js heap. Repeatable-read keeps the subsequent fetch on the same
        // snapshot so concurrent writes cannot invalidate this preflight.
        const [metrics] = await tx.$queryRaw<WorkspaceExportMetrics[]>`
          SELECT
            COUNT(*)::bigint AS "documentCount",
            COUNT(*) FILTER (WHERE "type" = 'FILE')::bigint AS "fileCount",
            COALESCE(SUM(octet_length(COALESCE("content", ''))), 0)::bigint AS "contentBytes"
          FROM "Document"
          WHERE "workspaceId" = ${workspaceId}
        `;
        this.assertWorkspaceExportLimits(
          Number(metrics?.documentCount ?? 0),
          Number(metrics?.fileCount ?? 0),
          Number(metrics?.contentBytes ?? 0),
        );

        const docs = await tx.document.findMany({
          where: { workspaceId },
          orderBy: { path: 'asc' },
          select: { type: true, path: true, content: true },
          take: WORKSPACE_EXPORT_MAX_DOCUMENTS + 1,
        });

        let observedFiles = 0;
        let observedContentBytes = 0;
        for (const doc of docs) {
          if (doc.type === DocumentType.FILE) observedFiles += 1;
          observedContentBytes += Buffer.byteLength(doc.content ?? '', 'utf8');
        }
        this.assertWorkspaceExportLimits(
          docs.length,
          observedFiles,
          observedContentBytes,
        );
        return { workspace, docs };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

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
    if (buffer.byteLength > WORKSPACE_EXPORT_MAX_ARCHIVE_BYTES) {
      throw new PayloadTooLargeException(
        'Workspace export exceeds the 25 MiB archive limit',
      );
    }
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
    this.assertDocumentContentLimit(content);
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
    this.assertDocumentContentLimit(data.content);
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
          const occupied = new Set([
            ...allDocuments.map((document) => document.path),
            ...changes.map((change) => change.path),
          ]);
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
    if (Buffer.byteLength(name, 'utf8') > DOCUMENT_MAX_SEGMENT_BYTES) {
      throw new BadRequestException(
        `Document name exceeds ${DOCUMENT_MAX_SEGMENT_BYTES} UTF-8 bytes`,
      );
    }
    return name;
  }

  private assertBulkImportLimits(
    documents: Omit<CreateDocumentData, 'workspaceId'>[],
  ): void {
    if (documents.length > BULK_IMPORT_MAX_DOCUMENTS) {
      throw new PayloadTooLargeException(
        `Bulk import is limited to ${BULK_IMPORT_MAX_DOCUMENTS} documents`,
      );
    }

    let fileCount = 0;
    let totalContentBytes = 0;
    for (const document of documents) {
      if (document.type === DocumentType.FILE) {
        fileCount += 1;
        if (fileCount > BULK_IMPORT_MAX_FILES) {
          throw new PayloadTooLargeException(
            `Bulk import is limited to ${BULK_IMPORT_MAX_FILES} files`,
          );
        }
      }
      const contentBytes = this.assertDocumentContentLimit(
        document.content,
        document.path,
      );
      totalContentBytes += contentBytes;
      if (totalContentBytes > BULK_IMPORT_MAX_TOTAL_CONTENT_BYTES) {
        throw new PayloadTooLargeException(
          'Bulk import exceeds the 25 MiB total content limit',
        );
      }
    }
  }

  private assertWorkspaceExportLimits(
    documentCount: number,
    fileCount: number,
    contentBytes: number,
  ): void {
    if (documentCount > WORKSPACE_EXPORT_MAX_DOCUMENTS) {
      throw new PayloadTooLargeException(
        `Workspace export is limited to ${WORKSPACE_EXPORT_MAX_DOCUMENTS} documents`,
      );
    }
    if (fileCount > WORKSPACE_EXPORT_MAX_FILES) {
      throw new PayloadTooLargeException(
        `Workspace export is limited to ${WORKSPACE_EXPORT_MAX_FILES} files`,
      );
    }
    if (contentBytes > WORKSPACE_EXPORT_MAX_CONTENT_BYTES) {
      throw new PayloadTooLargeException(
        'Workspace export exceeds the 25 MiB source-content limit',
      );
    }
  }

  private assertDocumentContentLimit(
    content: string | null | undefined,
    path?: string,
  ): number {
    const contentBytes = Buffer.byteLength(content ?? '', 'utf8');
    if (contentBytes > BULK_IMPORT_MAX_CONTENT_BYTES) {
      const subject = path === undefined ? 'Document' : `Document "${path}"`;
      throw new PayloadTooLargeException(
        `${subject} exceeds the 1 MiB content limit`,
      );
    }
    return contentBytes;
  }

  private validateDocumentPath(path: string): string {
    if (path.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')) {
      throw new BadRequestException('Document path contains an unsafe segment');
    }
    try {
      const clean = assertSafeRelPath(path);
      const segments = clean.split('/');
      if (Buffer.byteLength(clean, 'utf8') > DOCUMENT_MAX_PATH_BYTES) {
        throw new Error('path too long');
      }
      if (segments.length > DOCUMENT_MAX_DEPTH) {
        throw new Error('path too deep');
      }
      if (
        segments.some(
          (segment) =>
            Buffer.byteLength(segment, 'utf8') > DOCUMENT_MAX_SEGMENT_BYTES,
        )
      ) {
        throw new Error('path segment too long');
      }
      return clean;
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
      if (cursor.parentId === null) return;
      const ancestor = byId.get(cursor.parentId);
      if (ancestor === undefined) {
        throw new BadRequestException(
          'Parent hierarchy must stay within the same workspace',
        );
      }
      cursor = ancestor;
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
   * The whole restore is one transaction holding the document advisory lock,
   * which serializes it against every persistence write, compaction, and
   * concurrent restore across all API replicas. Atomically it:
   *
   *   1. increments Document.crdtGeneration (the restore fence);
   *   2. rewrites Document.content;
   *   3. records a new version capturing the restored content;
   *   4. replaces the CRDT history with a single seq-0 snapshot of the
   *      restored text under the new generation.
   *
   * Any in-flight Yjs write tagged with the old generation is rejected by
   * DocumentPersistenceService's in-transaction fence, so pre-restore state
   * can never be committed after this transaction. The cross-replica
   * eviction/resync broadcast is handled by the caller via
   * DocumentRestoreService after this commits.
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
      await acquireDocumentLock(tx, documentId);

      const document = await tx.document.update({
        where: { id: documentId },
        data: {
          content: source.content,
          crdtGeneration: { increment: 1 },
        },
      });
      const generation = document.crdtGeneration;

      // Replace the CRDT history: the old lineage still encodes pre-restore
      // text and must never be replayed. The new lineage starts as a single
      // snapshot so cold loads on any replica rebuild exactly the restored
      // state.
      await tx.documentUpdate.deleteMany({ where: { documentId } });
      await tx.snapshot.deleteMany({ where: { documentId } });
      await tx.snapshot.create({
        data: {
          documentId,
          generation,
          seq: 0,
          state: Buffer.from(
            encodeSeededState(documentId, generation, source.content),
          ),
        },
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
        generation,
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
    // Make max+1 allocation an explicit cross-process critical section. The
    // transaction-scoped lock is released automatically on commit, rollback,
    // or connection loss, and prevents concurrent replicas from selecting the
    // same version number.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`version:${params.documentId}`}, 0)
      )
    `;
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
