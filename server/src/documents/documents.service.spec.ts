import { NotFoundException } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Document, DocumentVersion } from '@prisma/client';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DocumentsService,
  type CreateDocumentData,
  type UpdateDocumentData,
} from './documents.service';

const BASE_DOC: Document = {
  id: 'doc-1',
  workspaceId: 'ws-1',
  parentId: null,
  type: DocumentType.FILE,
  path: 'src/index.ts',
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
    service = new DocumentsService(prisma);
  });

  describe('createDocument', () => {
    it('creates and returns the document', async () => {
      const data: CreateDocumentData = {
        workspaceId: 'ws-1',
        type: DocumentType.FILE,
        path: 'src/index.ts',
        name: 'index.ts',
        language: 'typescript',
      };
      prisma.document.create.mockResolvedValue(BASE_DOC);

      const result = await service.createDocument(data);

      expect(prisma.document.create).toHaveBeenCalledWith({ data });
      expect(result).toEqual(BASE_DOC);
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
  });

  describe('updateMetadata', () => {
    it('updates the specified metadata fields', async () => {
      const data: UpdateDocumentData = { name: 'renamed.ts', path: 'src/renamed.ts' };
      const updated = { ...BASE_DOC, ...data };
      prisma.document.update.mockResolvedValue(updated);

      const result = await service.updateMetadata('doc-1', data);

      expect(prisma.document.update).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data,
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
      prisma.document.findUnique.mockResolvedValue({
        content: 'old',
        workspaceId: 'ws-1',
      } as Document);
      prisma.document.update.mockResolvedValue({ ...BASE_DOC, content: 'new' });
      prisma.documentVersion.findFirst.mockResolvedValue(null);
      prisma.documentVersion.create.mockResolvedValue({} as DocumentVersion);

      await service.patchDocument('doc-1', { content: 'new' }, 'user-1');

      expect(prisma.documentVersion.create).toHaveBeenCalledTimes(1);
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

    it('does NOT create a version when content is unchanged (no duplicates)', async () => {
      prisma.document.findUnique.mockResolvedValue({
        content: 'same',
        workspaceId: 'ws-1',
      } as Document);
      prisma.document.update.mockResolvedValue({ ...BASE_DOC, content: 'same' });

      await service.patchDocument('doc-1', { content: 'same' }, 'user-1');

      expect(prisma.documentVersion.create).not.toHaveBeenCalled();
    });

    it('does NOT create a version for a metadata-only patch', async () => {
      prisma.document.findUnique.mockResolvedValue({
        content: 'x',
        workspaceId: 'ws-1',
      } as Document);
      prisma.document.update.mockResolvedValue({ ...BASE_DOC, name: 'renamed.ts' });

      await service.patchDocument('doc-1', { name: 'renamed.ts' }, 'user-1');

      expect(prisma.documentVersion.create).not.toHaveBeenCalled();
    });

    it('increments versionNumber from the current max for the document', async () => {
      prisma.document.findUnique.mockResolvedValue({
        content: 'old',
        workspaceId: 'ws-1',
      } as Document);
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
});
