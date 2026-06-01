import { Injectable } from '@nestjs/common';
import type { Document } from '@prisma/client';
import { DocumentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type { DocumentType };

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

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDocument(data: CreateDocumentData): Promise<Document> {
    return this.prisma.document.create({ data });
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
    return this.prisma.document.update({
      where: { id: documentId },
      data,
    });
  }

  async patchDocument(
    documentId: string,
    data: PatchDocumentData,
  ): Promise<Document> {
    return this.prisma.document.update({
      where: { id: documentId },
      data,
    });
  }

  async deleteDocument(documentId: string): Promise<void> {
    await this.prisma.document.delete({ where: { id: documentId } });
  }
}
