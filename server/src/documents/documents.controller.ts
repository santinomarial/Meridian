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
  UseGuards,
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
import { SkipThrottle } from '@nestjs/throttler';
import type { Document } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { BulkCreateDocumentsDto } from './dto/bulk-create-documents.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../modules/auth/types/auth-user.type';

@SkipThrottle({ auth: true })
@ApiTags('documents')
@UseGuards(JwtAuthGuard)
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
  async listDocuments(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    await this.requireWorkspaceAccess(user, workspaceId);
    return this.documentsService.listForWorkspace(workspaceId);
  }

  @Get('workspaces/:workspaceId/documents/tree')
  @ApiOperation({ summary: 'Get the document tree for a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiOkResponse({ description: 'Nested tree of DocumentNode objects' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async getTree(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ) {
    await this.requireWorkspaceAccess(user, workspaceId);
    return this.documentsService.getTree(workspaceId);
  }

  @Post('workspaces/:workspaceId/documents')
  @ApiOperation({ summary: 'Create a document in a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiCreatedResponse({ description: 'The created document' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async createDocument(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateDocumentDto,
  ) {
    await this.requireWorkspaceAccess(user, workspaceId);
    return this.documentsService.createDocument({ workspaceId, ...dto });
  }

  @Post('workspaces/:workspaceId/documents/bulk')
  @ApiOperation({
    summary:
      'Create many documents at once (e.g. ZIP import). Parents are resolved by path.',
  })
  @ApiParam({ name: 'workspaceId', description: 'Workspace cuid' })
  @ApiCreatedResponse({ description: 'Array of created documents, in input order' })
  @ApiNotFoundResponse({ description: 'Workspace not found' })
  async bulkCreateDocuments(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: BulkCreateDocumentsDto,
  ) {
    await this.requireWorkspaceAccess(user, workspaceId);
    return this.documentsService.bulkCreateDocuments(workspaceId, dto.documents);
  }

  @Get('documents/:documentId')
  @ApiOperation({ summary: 'Get a document by id' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiOkResponse({ description: 'The document' })
  @ApiNotFoundResponse({ description: 'Document not found' })
  async getDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
  ) {
    return this.requireDocumentAccess(user, documentId);
  }

  @Patch('documents/:documentId')
  @ApiOperation({ summary: 'Update document content or metadata' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiOkResponse({ description: 'The updated document' })
  @ApiNotFoundResponse({ description: 'Document not found' })
  async updateDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    await this.requireDocumentAccess(user, documentId);
    return this.documentsService.patchDocument(documentId, dto);
  }

  @Delete('documents/:documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a document and its children' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiNoContentResponse({ description: 'Document deleted' })
  @ApiNotFoundResponse({ description: 'Document not found' })
  async deleteDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
  ) {
    await this.requireDocumentAccess(user, documentId);
    await this.documentsService.deleteDocument(documentId);
  }

  // Non-members receive 404 (not 403) so resource ids are not enumerable.

  private async requireWorkspaceAccess(
    user: AuthUser,
    workspaceId: string,
  ): Promise<void> {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    const allowed = await this.workspacesService.canUserAccessWorkspace(
      user.id,
      workspaceId,
    );
    if (!allowed)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
  }

  private async requireDocumentAccess(
    user: AuthUser,
    documentId: string,
  ): Promise<Document> {
    const doc = await this.documentsService.findById(documentId);
    if (doc === null)
      throw new NotFoundException(`Document ${documentId} not found`);
    const allowed = await this.workspacesService.canUserAccessWorkspace(
      user.id,
      doc.workspaceId,
    );
    if (!allowed)
      throw new NotFoundException(`Document ${documentId} not found`);
    return doc;
  }
}
