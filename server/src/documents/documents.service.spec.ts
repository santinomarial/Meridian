import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import JSZip from 'jszip';
import type { Document, DocumentVersion } from '@prisma/client';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DocumentsService,
  WORKSPACE_EXPORT_MAX_ARCHIVE_BYTES,
  WORKSPACE_EXPORT_MAX_CONTENT_BYTES,
  WORKSPACE_EXPORT_MAX_DOCUMENTS,
  sanitizeZipFilenameStem,
  isExcludedExportPath,
  type CreateDocumentData,
  type UpdateDocumentData,
} from './documents.service';

const BASE_DOC: Document = {
  id: 'doc-1',
  workspaceId: 'ws-1',
  parentId: null,
  type: DocumentType.FILE,
  path: 'index.ts',
  name: 'index.ts',
  language: 'typescript',
  content: 'export {};',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const FOLDER_DOC: Document = {
  ...BASE_DOC,
  id: 'folder-1',
  type: DocumentType.FOLDER,
  path: 'src',
  name: 'src',
  language: null,
  content: null,
  parentId: null,
};

const CHILD_DOC: Document = {
  ...BASE_DOC,
  id: 'doc-2',
  parentId: 'folder-1',
  path: 'src/auth.ts',
  name: 'auth.ts',
};

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    prisma.$queryRaw.mockResolvedValue([
      { documentCount: 0n, fileCount: 0n, contentBytes: 0n },
    ] as never);
    service = new DocumentsService(prisma);
  });

  describe('createDocument', () => {
    it('creates and returns the document', async () => {
      const data: CreateDocumentData = {
        workspaceId: 'ws-1',
        type: DocumentType.FILE,
        path: 'index.ts',
        name: 'index.ts',
        language: 'typescript',
      };
      prisma.document.create.mockResolvedValue(BASE_DOC);

      const result = await service.createDocument(data);

      expect(prisma.document.create).toHaveBeenCalledWith({
        data: { ...data, parentId: null },
      });
      expect(result).toEqual(BASE_DOC);
    });

    it('creates a child only under a folder in the same workspace', async () => {
      const data: CreateDocumentData = {
        workspaceId: 'ws-1',
        parentId: 'folder-1',
        type: DocumentType.FILE,
        path: 'src/auth.ts',
        name: 'auth.ts',
      };
      prisma.document.findUnique.mockResolvedValue(FOLDER_DOC);
      prisma.document.create.mockResolvedValue(CHILD_DOC);

      await service.createDocument(data);

      expect(prisma.document.create).toHaveBeenCalledWith({ data });
    });

    it('rejects a parent from another workspace', async () => {
      prisma.document.findUnique.mockResolvedValue({
        ...FOLDER_DOC,
        workspaceId: 'ws-2',
      });

      await expect(
        service.createDocument({
          workspaceId: 'ws-1',
          parentId: 'folder-1',
          type: DocumentType.FILE,
          path: 'src/auth.ts',
          name: 'auth.ts',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.document.create).not.toHaveBeenCalled();
    });

    it('rejects using a file as a parent', async () => {
      prisma.document.findUnique.mockResolvedValue(BASE_DOC);

      await expect(
        service.createDocument({
          workspaceId: 'ws-1',
          parentId: 'doc-1',
          type: DocumentType.FILE,
          path: 'index.ts/auth.ts',
          name: 'auth.ts',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a path that disagrees with its parent and name', async () => {
      prisma.document.findUnique.mockResolvedValue(FOLDER_DOC);

      await expect(
        service.createDocument({
          workspaceId: 'ws-1',
          parentId: 'folder-1',
          type: DocumentType.FILE,
          path: 'other/auth.ts',
          name: 'auth.ts',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a single document with more than 1 MiB of content', async () => {
      await expect(
        service.createDocument({
          workspaceId: 'ws-1',
          type: DocumentType.FILE,
          path: 'large.txt',
          name: 'large.txt',
          content: 'x'.repeat(1024 * 1024 + 1),
        }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(prisma.document.create).not.toHaveBeenCalled();
    });

    it('rejects filesystem-impossible names and excessively deep paths', async () => {
      const longName = `${'a'.repeat(256)}.txt`;
      await expect(
        service.createDocument({
          workspaceId: 'ws-1',
          type: DocumentType.FILE,
          path: longName,
          name: longName,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const deepPath = `${Array.from({ length: 65 }, () => 'd').join('/')}/x.txt`;
      await expect(
        service.createDocument({
          workspaceId: 'ws-1',
          type: DocumentType.FILE,
          path: deepPath,
          name: 'x.txt',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.document.create).not.toHaveBeenCalled();
    });
  });

  describe('bulkCreateDocuments', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation(
        async (cb: (tx: typeof prisma) => unknown) => cb(prisma),
      );
    });

    it('resolves imported descendants to their folder parent', async () => {
      prisma.document.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.document.create
        .mockResolvedValueOnce(FOLDER_DOC)
        .mockResolvedValueOnce(CHILD_DOC);

      await service.bulkCreateDocuments('ws-1', [
        {
          type: DocumentType.FILE,
          path: 'src/auth.ts',
          name: 'auth.ts',
        },
        { type: DocumentType.FOLDER, path: 'src', name: 'src' },
      ]);

      expect(prisma.document.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          path: 'src/auth.ts',
          parentId: 'folder-1',
        }),
      });
    });

    it('rejects an import whose parent path does not exist', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      await expect(
        service.bulkCreateDocuments('ws-1', [
          {
            type: DocumentType.FILE,
            path: 'missing/auth.ts',
            name: 'auth.ts',
          },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.document.create).not.toHaveBeenCalled();
    });

    it('rejects importing over an existing document of another type', async () => {
      prisma.document.findUnique.mockResolvedValue(BASE_DOC);

      await expect(
        service.bulkCreateDocuments('ws-1', [
          { type: DocumentType.FOLDER, path: 'index.ts', name: 'index.ts' },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects more than 2,000 documents before opening a transaction', async () => {
      const documents = Array.from({ length: 2_001 }, (_, index) => ({
        type: DocumentType.FOLDER,
        path: `folder-${index}`,
        name: `folder-${index}`,
      }));

      await expect(
        service.bulkCreateDocuments('ws-1', documents),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects more than 1,000 files before opening a transaction', async () => {
      const documents = Array.from({ length: 1_001 }, (_, index) => ({
        type: DocumentType.FILE,
        path: `file-${index}.txt`,
        name: `file-${index}.txt`,
      }));

      await expect(
        service.bulkCreateDocuments('ws-1', documents),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a document with more than 1 MiB of content', async () => {
      await expect(
        service.bulkCreateDocuments('ws-1', [
          {
            type: DocumentType.FILE,
            path: 'large.txt',
            name: 'large.txt',
            content: 'x'.repeat(1024 * 1024 + 1),
          },
        ]),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects more than 25 MiB of aggregate content', async () => {
      const oneMiB = 'x'.repeat(1024 * 1024);
      const documents = Array.from({ length: 26 }, (_, index) => ({
        type: DocumentType.FILE,
        path: `file-${index}.txt`,
        name: `file-${index}.txt`,
        content: oneMiB,
      }));

      await expect(
        service.bulkCreateDocuments('ws-1', documents),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('returns the document when found', async () => {
      prisma.document.findUnique.mockResolvedValue(BASE_DOC);

      const result = await service.findById('doc-1');

      expect(prisma.document.findUnique).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
      expect(result).toEqual(BASE_DOC);
    });

    it('returns null when not found', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      expect(await service.findById('missing')).toBeNull();
    });
  });

  describe('listForWorkspace', () => {
    it('returns all documents ordered by path', async () => {
      prisma.document.findMany.mockResolvedValue([FOLDER_DOC, BASE_DOC]);

      const result = await service.listForWorkspace('ws-1');

      expect(prisma.document.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1' },
        orderBy: { path: 'asc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('getTree', () => {
    it('returns root-level nodes when there are no parent-child relationships', async () => {
      prisma.document.findMany.mockResolvedValue([FOLDER_DOC, BASE_DOC]);

      const tree = await service.getTree('ws-1');

      expect(tree).toHaveLength(2);
      expect(tree.every((n) => n.children.length === 0)).toBe(true);
    });

    it('nests children under their parent', async () => {
      prisma.document.findMany.mockResolvedValue([FOLDER_DOC, CHILD_DOC]);

      const tree = await service.getTree('ws-1');

      expect(tree).toHaveLength(1);
      expect(tree[0]!.id).toBe('folder-1');
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.id).toBe('doc-2');
    });

    it('returns empty array for a workspace with no documents', async () => {
      prisma.document.findMany.mockResolvedValue([]);

      expect(await service.getTree('ws-1')).toEqual([]);
    });
  });

  describe('updateContent', () => {
    it('updates and returns the document with new content', async () => {
      const updated = { ...BASE_DOC, content: 'const x = 1;' };
      prisma.document.update.mockResolvedValue(updated);

      const result = await service.updateContent('doc-1', 'const x = 1;');

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { content: 'const x = 1;' },
      });
      expect(result.content).toBe('const x = 1;');
    });

    it('rejects content larger than 1 MiB', async () => {
      await expect(
        service.updateContent('doc-1', 'x'.repeat(1024 * 1024 + 1)),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(prisma.document.update).not.toHaveBeenCalled();
    });
  });

  describe('updateMetadata', () => {
    it('updates the specified metadata fields', async () => {
      prisma.$transaction.mockImplementation(
        async (cb: (tx: typeof prisma) => unknown) => cb(prisma),
      );
      const data: UpdateDocumentData = { name: 'renamed.ts', path: 'renamed.ts' };
      const updated = { ...BASE_DOC, ...data };
      prisma.document.findUnique.mockResolvedValue(BASE_DOC);
      prisma.document.findMany.mockResolvedValue([BASE_DOC]);
      prisma.document.update.mockResolvedValue(updated);

      const result = await service.updateMetadata('doc-1', data);

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { ...data, parentId: null },
      });
      expect(result.name).toBe('renamed.ts');
    });
  });

  describe('deleteDocument', () => {
    it('deletes the document without returning a value', async () => {
      prisma.document.delete.mockResolvedValue(BASE_DOC);

      await service.deleteDocument('doc-1');

      expect(prisma.document.delete).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
    });
  });

  // ── Version creation on save ────────────────────────────────────────────────

  describe('patchDocument', () => {
    // Make $transaction run its callback with the prisma mock as the tx client.
    beforeEach(() => {
      prisma.$transaction.mockImplementation(
        async (cb: (tx: typeof prisma) => unknown) => cb(prisma),
      );
    });

    it('creates a version when content meaningfully changes', async () => {
      prisma.document.findUnique.mockResolvedValue({ ...BASE_DOC, content: 'old' });
      prisma.document.update.mockResolvedValue({ ...BASE_DOC, content: 'new' });
      prisma.documentVersion.findFirst.mockResolvedValue(null);
      prisma.documentVersion.create.mockResolvedValue({} as DocumentVersion);

      await service.patchDocument('doc-1', { content: 'new' }, 'user-1');

      expect(prisma.documentVersion.create).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.documentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentId: 'doc-1',
          workspaceId: 'ws-1',
          createdById: 'user-1',
          versionNumber: 1,
          content: 'new',
          message: null,
        }),
      });
    });

    it('rejects content larger than 1 MiB before opening a transaction', async () => {
      await expect(
        service.patchDocument(
          'doc-1',
          { content: 'x'.repeat(1024 * 1024 + 1) },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does NOT create a version when content is unchanged (no duplicates)', async () => {
      prisma.document.findUnique.mockResolvedValue({ ...BASE_DOC, content: 'same' });
      prisma.document.update.mockResolvedValue({ ...BASE_DOC, content: 'same' });

      await service.patchDocument('doc-1', { content: 'same' }, 'user-1');

      expect(prisma.documentVersion.create).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('does NOT create a version for a metadata-only patch', async () => {
      prisma.document.findUnique.mockResolvedValue({ ...BASE_DOC, content: 'x' });
      prisma.document.findMany.mockResolvedValue([BASE_DOC]);
      prisma.document.update.mockResolvedValue({ ...BASE_DOC, name: 'renamed.ts' });

      await service.patchDocument('doc-1', { name: 'renamed.ts' }, 'user-1');

      expect(prisma.documentVersion.create).not.toHaveBeenCalled();
    });

    it('increments versionNumber from the current max for the document', async () => {
      prisma.document.findUnique.mockResolvedValue({ ...BASE_DOC, content: 'old' });
      prisma.document.update.mockResolvedValue({ ...BASE_DOC, content: 'new' });
      prisma.documentVersion.findFirst.mockResolvedValue({
        versionNumber: 7,
      } as DocumentVersion);
      prisma.documentVersion.create.mockResolvedValue({} as DocumentVersion);

      await service.patchDocument('doc-1', { content: 'new' }, 'user-1');

      expect(prisma.documentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ versionNumber: 8 }),
      });
    });

    it('throws NotFound when the document does not exist', async () => {
      prisma.document.findUnique.mockResolvedValue(null);

      await expect(
        service.patchDocument('missing', { content: 'x' }, 'user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects moving a document under itself', async () => {
      prisma.document.findUnique.mockResolvedValue(FOLDER_DOC);
      prisma.document.findMany.mockResolvedValue([FOLDER_DOC]);

      await expect(
        service.patchDocument('folder-1', { parentId: 'folder-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.document.update).not.toHaveBeenCalled();
    });

    it('rejects moving a document under a file', async () => {
      prisma.document.findUnique.mockResolvedValue(FOLDER_DOC);
      prisma.document.findMany.mockResolvedValue([FOLDER_DOC, BASE_DOC]);

      await expect(
        service.patchDocument('folder-1', { parentId: 'doc-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects moving a folder into one of its descendants', async () => {
      const childFolder: Document = {
        ...FOLDER_DOC,
        id: 'folder-2',
        parentId: 'folder-1',
        path: 'src/lib',
        name: 'lib',
      };
      prisma.document.findUnique.mockResolvedValue(FOLDER_DOC);
      prisma.document.findMany.mockResolvedValue([FOLDER_DOC, childFolder]);

      await expect(
        service.patchDocument('folder-1', { parentId: 'folder-2' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('updates every descendant path atomically when a folder is renamed', async () => {
      const childFolder: Document = {
        ...FOLDER_DOC,
        id: 'folder-2',
        parentId: 'folder-1',
        path: 'src/lib',
        name: 'lib',
      };
      const grandchild: Document = {
        ...CHILD_DOC,
        id: 'doc-3',
        parentId: 'folder-2',
        path: 'src/lib/auth.ts',
      };
      prisma.document.findUnique.mockResolvedValue(FOLDER_DOC);
      prisma.document.findMany.mockResolvedValue([
        FOLDER_DOC,
        childFolder,
        grandchild,
      ]);
      prisma.document.update.mockResolvedValue({
        ...FOLDER_DOC,
        path: 'source',
        name: 'source',
      });

      const result = await service.patchDocument('folder-1', {
        name: 'source',
        path: 'source',
      });

      expect(result.path).toBe('source');
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'folder-2' },
        data: { path: 'source/lib' },
      });
      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-3' },
        data: { path: 'source/lib/auth.ts' },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── Version listing / reading ───────────────────────────────────────────────

  describe('listVersions', () => {
    it('returns lightweight items (no content) newest first', async () => {
      prisma.documentVersion.findMany.mockResolvedValue([
        {
          id: 'v-2',
          versionNumber: 2,
          message: 'Restored from version 1',
          createdAt: new Date('2024-02-01'),
          content: 'hello world',
          createdBy: { id: 'user-1', displayName: 'Ada' },
        },
      ] as never);

      const result = await service.listVersions('doc-1');

      expect(prisma.documentVersion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { documentId: 'doc-1' },
          orderBy: { versionNumber: 'desc' },
        }),
      );
      expect(result[0]).toEqual({
        id: 'v-2',
        versionNumber: 2,
        message: 'Restored from version 1',
        createdAt: new Date('2024-02-01'),
        contentLength: 'hello world'.length,
        createdBy: { id: 'user-1', displayName: 'Ada' },
      });
      expect(result[0]).not.toHaveProperty('content');
    });
  });

  describe('getVersion', () => {
    it('returns the full content when the version belongs to the document', async () => {
      prisma.documentVersion.findUnique.mockResolvedValue({
        id: 'v-1',
        documentId: 'doc-1',
        versionNumber: 1,
        message: null,
        createdAt: new Date('2024-01-01'),
        content: 'export const x = 1;',
        createdBy: { id: 'user-1', displayName: 'Ada' },
      } as never);

      const result = await service.getVersion('doc-1', 'v-1');

      expect(result.content).toBe('export const x = 1;');
      expect(result.documentId).toBe('doc-1');
    });

    it('throws NotFound when the version belongs to a different document', async () => {
      prisma.documentVersion.findUnique.mockResolvedValue({
        id: 'v-1',
        documentId: 'other-doc',
      } as never);

      await expect(service.getVersion('doc-1', 'v-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound when the version does not exist', async () => {
      prisma.documentVersion.findUnique.mockResolvedValue(null);

      await expect(service.getVersion('doc-1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── Restore ─────────────────────────────────────────────────────────────────

  describe('restoreVersion', () => {
    beforeEach(() => {
      prisma.$transaction.mockImplementation(
        async (cb: (tx: typeof prisma) => unknown) => cb(prisma),
      );
    });

    it('updates content and records a new version with a restore message', async () => {
      prisma.documentVersion.findUnique.mockResolvedValue({
        id: 'v-1',
        documentId: 'doc-1',
        workspaceId: 'ws-1',
        versionNumber: 1,
        content: 'restored body',
        message: null,
        createdAt: new Date('2024-01-01'),
        createdById: 'user-1',
      } as DocumentVersion);
      prisma.document.update.mockResolvedValue({
        ...BASE_DOC,
        content: 'restored body',
      });
      prisma.documentVersion.findFirst.mockResolvedValue({
        versionNumber: 3,
      } as DocumentVersion);
      prisma.documentVersion.create.mockResolvedValue({
        versionNumber: 4,
      } as DocumentVersion);

      const result = await service.restoreVersion('doc-1', 'v-1', 'user-9');

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { content: 'restored body' },
      });
      expect(prisma.documentVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          versionNumber: 4,
          content: 'restored body',
          createdById: 'user-9',
          message: 'Restored from version 1',
        }),
      });
      expect(result).toEqual({
        document: expect.objectContaining({ content: 'restored body' }),
        restoredFromVersion: 1,
        newVersionNumber: 4,
        content: 'restored body',
      });
    });

    it('rejects a version that does not belong to the document', async () => {
      prisma.documentVersion.findUnique.mockResolvedValue({
        id: 'v-1',
        documentId: 'other-doc',
      } as DocumentVersion);

      await expect(
        service.restoreVersion('doc-1', 'v-1', 'user-9'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.document.update).not.toHaveBeenCalled();
    });
  });

  // ── Export ──────────────────────────────────────────────────────────────────

  describe('exportWorkspaceZip', () => {
    type ExportDoc = { type: DocumentType; path: string; content: string | null };

    function setExportDocs(name: string | null, docs: ExportDoc[]): void {
      prisma.workspace.findUnique.mockResolvedValue(
        name === null ? null : ({ name } as never),
      );
      prisma.$queryRaw.mockResolvedValue([{
        documentCount: BigInt(docs.length),
        fileCount: BigInt(docs.filter((doc) => doc.type === DocumentType.FILE).length),
        contentBytes: BigInt(
          docs.reduce(
            (total, doc) => total + Buffer.byteLength(doc.content ?? '', 'utf8'),
            0,
          ),
        ),
      }] as never);
      prisma.document.findMany.mockResolvedValue(docs as never);
    }

    it('builds a zip with expected paths/contents and preserves nested folders', async () => {
      setExportDocs('My Project', [
        { type: DocumentType.FOLDER, path: 'src', content: null },
        { type: DocumentType.FILE, path: 'src/main.py', content: 'print("hello export")' },
        { type: DocumentType.FILE, path: 'README.md', content: '# Hello' },
      ]);

      const { buffer, filename } = await service.exportWorkspaceZip('ws-1');

      expect(filename).toBe('My Project.zip');
      const zip = await JSZip.loadAsync(buffer);
      expect(zip.file('src/main.py')).not.toBeNull();
      expect(await zip.file('src/main.py')!.async('string')).toBe('print("hello export")');
      expect(await zip.file('README.md')!.async('string')).toBe('# Hello');
      // The folder entry is preserved.
      const folderEntry = zip.files['src/'];
      expect(folderEntry).toBeDefined();
      expect(folderEntry!.dir).toBe(true);
    });

    it('excludes .meridian-build/ and terminal artifacts', async () => {
      setExportDocs('w', [
        { type: DocumentType.FILE, path: 'app.js', content: 'ok' },
        { type: DocumentType.FILE, path: '.meridian-build/out.js', content: 'nope' },
        { type: DocumentType.FOLDER, path: '.terminal-sandboxes', content: null },
        { type: DocumentType.FILE, path: '.terminal-sandboxes/x.txt', content: 'nope' },
      ]);

      const { buffer } = await service.exportWorkspaceZip('ws-1');
      const zip = await JSZip.loadAsync(buffer);

      expect(zip.file('app.js')).not.toBeNull();
      expect(zip.file('.meridian-build/out.js')).toBeNull();
      expect(Object.keys(zip.files).some((k) => k.startsWith('.meridian-build'))).toBe(false);
      expect(Object.keys(zip.files).some((k) => k.startsWith('.terminal-sandboxes'))).toBe(false);
    });

    it('skips documents with unsafe (traversal/absolute) paths', async () => {
      setExportDocs('w', [
        { type: DocumentType.FILE, path: 'safe.txt', content: 'ok' },
        { type: DocumentType.FILE, path: '../escape.txt', content: 'pwned' },
        { type: DocumentType.FILE, path: '/etc/passwd', content: 'pwned' },
      ]);

      const { buffer } = await service.exportWorkspaceZip('ws-1');
      const zip = await JSZip.loadAsync(buffer);

      expect(zip.file('safe.txt')).not.toBeNull();
      expect(Object.keys(zip.files).every((k) => !k.includes('..'))).toBe(true);
      expect(Object.keys(zip.files).every((k) => !k.startsWith('/'))).toBe(true);
    });

    it('falls back to a safe filename when the workspace name is empty/unsafe', async () => {
      setExportDocs('...', []);
      expect((await service.exportWorkspaceZip('ws-1')).filename).toBe('workspace.zip');

      setExportDocs(null, []);
      expect((await service.exportWorkspaceZip('ws-1')).filename).toBe('workspace.zip');
    });

    it('rejects an oversized workspace before loading document rows', async () => {
      prisma.workspace.findUnique.mockResolvedValue({ name: 'large' } as never);
      prisma.$queryRaw.mockResolvedValue([{
        documentCount: BigInt(WORKSPACE_EXPORT_MAX_DOCUMENTS + 1),
        fileCount: 0n,
        contentBytes: 0n,
      }] as never);

      await expect(service.exportWorkspaceZip('ws-1')).rejects.toBeInstanceOf(
        PayloadTooLargeException,
      );
      expect(prisma.document.findMany).not.toHaveBeenCalled();
    });

    it('rejects source content over the preflight limit', async () => {
      prisma.workspace.findUnique.mockResolvedValue({ name: 'large' } as never);
      prisma.$queryRaw.mockResolvedValue([{
        documentCount: 1n,
        fileCount: 1n,
        contentBytes: BigInt(WORKSPACE_EXPORT_MAX_CONTENT_BYTES + 1),
      }] as never);

      await expect(service.exportWorkspaceZip('ws-1')).rejects.toBeInstanceOf(
        PayloadTooLargeException,
      );
      expect(prisma.document.findMany).not.toHaveBeenCalled();
    });

    it('enforces the final archive byte limit', async () => {
      const content = 'x'.repeat(WORKSPACE_EXPORT_MAX_ARCHIVE_BYTES);
      setExportDocs('large', [
        { type: DocumentType.FILE, path: 'large.txt', content },
      ]);

      await expect(service.exportWorkspaceZip('ws-1')).rejects.toBeInstanceOf(
        PayloadTooLargeException,
      );
    });
  });

  describe('export helpers', () => {
    it('sanitizeZipFilenameStem strips unsafe chars and falls back to "workspace"', () => {
      expect(sanitizeZipFilenameStem('My Project')).toBe('My Project');
      expect(sanitizeZipFilenameStem('a/b\\c')).toBe('a_b_c');
      expect(sanitizeZipFilenameStem('')).toBe('workspace');
      expect(sanitizeZipFilenameStem('   ')).toBe('workspace');
    });

    it('isExcludedExportPath flags build/sandbox artifacts only', () => {
      expect(isExcludedExportPath('.meridian-build/out.js')).toBe(true);
      expect(isExcludedExportPath('.terminal-sandboxes/x')).toBe(true);
      expect(isExcludedExportPath('src/main.py')).toBe(false);
      expect(isExcludedExportPath('build/out.js')).toBe(false);
    });
  });
});
