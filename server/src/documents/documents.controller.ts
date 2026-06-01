import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

@Controller()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  @Get('workspaces/:workspaceId/documents')
  async listDocuments(@Param('workspaceId') workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    return this.documentsService.listForWorkspace(workspaceId);
  }

  @Get('workspaces/:workspaceId/documents/tree')
  async getTree(@Param('workspaceId') workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    return this.documentsService.getTree(workspaceId);
  }

  @Post('workspaces/:workspaceId/documents')
  async createDocument(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    await this.requireWorkspace(workspaceId);
    return this.documentsService.createDocument({ workspaceId, ...dto });
  }

  @Get('documents/:documentId')
  async getDocument(@Param('documentId') documentId: string) {
    const doc = await this.documentsService.findById(documentId);
    if (doc === null)
      throw new NotFoundException(`Document ${documentId} not found`);
    return doc;
  }

  @Patch('documents/:documentId')
  async updateDocument(
    @Param('documentId') documentId: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    const doc = await this.documentsService.findById(documentId);
    if (doc === null)
      throw new NotFoundException(`Document ${documentId} not found`);
    return this.documentsService.patchDocument(documentId, dto);
  }

  @Delete('documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(@Param('documentId') documentId: string) {
    const doc = await this.documentsService.findById(documentId);
    if (doc === null)
      throw new NotFoundException(`Document ${documentId} not found`);
    await this.documentsService.deleteDocument(documentId);
  }

  private async requireWorkspace(workspaceId: string): Promise<void> {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
  }
}
