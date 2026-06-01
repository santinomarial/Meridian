import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Document } from '@prisma/client';
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
});
