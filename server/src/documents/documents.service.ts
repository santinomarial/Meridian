import { Injectable } from '@nestjs/common';
import type { Document, Prisma } from '@prisma/client';
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
    const segmentCount = (path: string): number => path.split('/').length;
    const sorted = [...documents].sort(
      (a, b) => segmentCount(a.path) - segmentCount(b.path) || a.path.localeCompare(b.path),
    );

    return this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const idByPath = new Map<string, string>();
        const results: Document[] = [];

        for (const input of sorted) {
          const slashIdx = input.path.lastIndexOf('/');
          const parentPath = slashIdx > 0 ? input.path.slice(0, slashIdx) : null;
          const parentId =
            parentPath !== null ? (idByPath.get(parentPath) ?? null) : null;

          const existing = await tx.document.findUnique({
            where: { workspaceId_path: { workspaceId, path: input.path } },
          });

          let doc: Document;
          if (existing !== null) {
            doc =
              input.type === DocumentType.FILE
                ? await tx.document.update({
                    where: { id: existing.id },
                    data: {
                      content: input.content ?? existing.content,
                      language: input.language ?? existing.language,
                    },
                  })
                : existing;
          } else {
            doc = await tx.document.create({
              data: {
                workspaceId,
                parentId,
                type: input.type,
                path: input.path,
                name: input.name,
                language: input.language,
                content: input.content,
              },
            });
          }

          idByPath.set(input.path, doc.id);
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
