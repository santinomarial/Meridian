import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
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
import { DocumentType } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { DocumentRestoreService } from '../modules/realtime/document-restore.service';
import { TerminalSandboxService } from '../modules/terminal/terminal-sandbox.service';
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
    private readonly documentRestore: DocumentRestoreService,
    private readonly sandbox: TerminalSandboxService,
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
    await this.requireWorkspaceWriteAccess(user, workspaceId);
    const doc = await this.documentsService.createDocument({ workspaceId, ...dto });
    // Project the new node into any active terminal sandbox (best-effort).
    if (doc.type === DocumentType.FOLDER) {
      await this.sandbox.syncMkdir(workspaceId, doc.path);
    } else {
      await this.sandbox.syncWriteFile(workspaceId, doc.path, doc.content ?? '');
    }
    return doc;
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
    await this.requireWorkspaceWriteAccess(user, workspaceId);
    const docs = await this.documentsService.bulkCreateDocuments(workspaceId, dto.documents);
    for (const doc of docs) {
      if (doc.type === DocumentType.FOLDER) {
        await this.sandbox.syncMkdir(workspaceId, doc.path);
      } else {
        await this.sandbox.syncWriteFile(workspaceId, doc.path, doc.content ?? '');
      }
    }
    return docs;
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
    const before = await this.requireDocumentWriteAccess(user, documentId);
    const updated = await this.documentsService.patchDocument(documentId, dto, user.id);

    // Mirror the change into any active terminal sandbox (best-effort). Order
    // matters: rename the file/folder first, then write fresh content.
    if (updated.path !== before.path) {
      await this.sandbox.syncRename(updated.workspaceId, before.path, updated.path);
    }
    if (updated.type === DocumentType.FILE && dto.content !== undefined && dto.content !== null) {
      await this.sandbox.syncWriteFile(updated.workspaceId, updated.path, dto.content);
    }
    return updated;
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
    const doc = await this.requireDocumentWriteAccess(user, documentId);
    await this.documentsService.deleteDocument(documentId);
    // Remove the file/folder from any active terminal sandbox (best-effort).
    await this.sandbox.syncDelete(doc.workspaceId, doc.path);
  }

  // ---------------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------------

  @Get('documents/:documentId/versions')
  @ApiOperation({ summary: 'List saved versions of a document (newest first)' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiOkResponse({ description: 'Lightweight version metadata, newest first' })
  @ApiNotFoundResponse({ description: 'Document not found' })
  async listVersions(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
  ) {
    // Any workspace member (including viewers) may list versions.
    await this.requireDocumentAccess(user, documentId);
    return this.documentsService.listVersions(documentId);
  }

  @Get('documents/:documentId/versions/:versionId')
  @ApiOperation({ summary: 'Get the full content of a single version' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiParam({ name: 'versionId', description: 'Version cuid' })
  @ApiOkResponse({ description: 'The version with full content' })
  @ApiNotFoundResponse({ description: 'Document or version not found' })
  async getVersion(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
  ) {
    // Viewers may read version content; non-members get a 404 from the helper.
    await this.requireDocumentAccess(user, documentId);
    return this.documentsService.getVersion(documentId, versionId);
  }

  @Post('documents/:documentId/versions/:versionId/restore')
  @ApiOperation({ summary: 'Restore a document to a previous version' })
  @ApiParam({ name: 'documentId', description: 'Document cuid' })
  @ApiParam({ name: 'versionId', description: 'Version cuid' })
  @ApiOkResponse({ description: 'The restored document and version numbers' })
  @ApiNotFoundResponse({ description: 'Document or version not found' })
  async restoreVersion(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
  ) {
    // Restore mutates document content — editors and owners only.
    await this.requireDocumentWriteAccess(user, documentId);

    const result = await this.documentsService.restoreVersion(
      documentId,
      versionId,
      user.id,
    );

    // Reconcile the realtime layer (live Y.Doc, persisted CRDT history, and
    // connected clients) with the restored content.  See DocumentRestoreService
    // for the synchronization strategy.
    await this.documentRestore.applyRestore(documentId, result.content);

    // Mirror the restored content into any active terminal sandbox.
    await this.sandbox.syncWriteFile(
      result.document.workspaceId,
      result.document.path,
      result.content,
    );

    return {
      document: result.document,
      restoredFromVersion: result.restoredFromVersion,
      newVersionNumber: result.newVersionNumber,
    };
  }

  // Non-members receive 404 (not 403) so resource ids are not enumerable.
  // Members without write permission receive 403.

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

  private async requireWorkspaceWriteAccess(
    user: AuthUser,
    workspaceId: string,
  ): Promise<void> {
    const ws = await this.workspacesService.findById(workspaceId);
    if (ws === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    const role = await this.workspacesService.getMemberRole(user.id, workspaceId);
    if (role === null)
      throw new NotFoundException(`Workspace ${workspaceId} not found`);
    if (role === WorkspaceRole.VIEWER)
      throw new ForbiddenException('Viewers cannot modify documents');
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

  private async requireDocumentWriteAccess(
    user: AuthUser,
    documentId: string,
  ): Promise<Document> {
    const doc = await this.documentsService.findById(documentId);
    if (doc === null)
      throw new NotFoundException(`Document ${documentId} not found`);
    const role = await this.workspacesService.getMemberRole(user.id, doc.workspaceId);
    if (role === null)
      throw new NotFoundException(`Document ${documentId} not found`);
    if (role === WorkspaceRole.VIEWER)
      throw new ForbiddenException('Viewers cannot modify documents');
    return doc;
  }
}
