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
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';

@ApiTags('documents')
@Controller()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  @Get('workspaces/:workspaceId/documents')
  @ApiOperation({ summary: 'List all documents in a workspace (flat)' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'Array of documents ordered by path' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async listDocuments(@Param('workspaceId') workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    return this.documentsService.listForWorkspace(workspaceId);
  }

  @Get('workspaces/:workspaceId/documents/tree')
  @ApiOperation({ summary: 'Get the document tree for a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'Nested tree of DocumentNode objects' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async getTree(@Param('workspaceId') workspaceId: string) {
    await this.requireWorkspace(workspaceId);
    return this.documentsService.getTree(workspaceId);
  }

  @Post('workspaces/:workspaceId/documents')
  @ApiOperation({ summary: 'Create a document in a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiCreatedResponse({ description: 'The created document' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async createDocument(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    await this.requireWorkspace(workspaceId);
    return this.documentsService.createDocument({ workspaceId, ...dto });
  }

  @Get('documents/:documentId')
  @ApiOperation({ summary: 'Get a document by id' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiOkResponse({ description: 'The document' })
  @ApiNotFoundResponse({ description: 'Document not found' })
  async getDocument(@Param('documentId') documentId: string) {
    const doc = await this.documentsService.findById(documentId);
    if (doc === null)
      throw new NotFoundException(`Document ${documentId} not found`);
    return doc;
  }

  @Patch('documents/:documentId')
  @ApiOperation({ summary: 'Update document content or metadata' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiOkResponse({ description: 'The updated document' })
  @ApiNotFoundResponse({ description: 'Document not found' })
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
  @ApiOperation({ summary: 'Delete a document and its children' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiNoContentResponse({ description: 'Document deleted' })
  @ApiNotFoundResponse({ description: 'Document not found' })
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
