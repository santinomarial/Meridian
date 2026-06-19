import { NotFoundException, StreamableFile } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import type { Workspace } from '@prisma/client';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { DocumentRestoreService } from '../modules/realtime/document-restore.service';
import { TerminalSandboxService } from '../modules/terminal/terminal-sandbox.service';
import type { AuthUser } from '../modules/auth/types/auth-user.type';

const USER: AuthUser = {
  id: 'user-1',
  email: 'u@example.com',
  displayName: 'U',
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

function makeController() {
  const documents = mockDeep<DocumentsService>();
  const workspaces = mockDeep<WorkspacesService>();
  const restore = mockDeep<DocumentRestoreService>();
  const sandbox = mockDeep<TerminalSandboxService>();
  const controller = new DocumentsController(documents, workspaces, restore, sandbox);
  return { controller, documents, workspaces };
}

describe('DocumentsController — export', () => {
  it('rejects a non-member with 404 and never builds a zip', async () => {
    const { controller, documents, workspaces } = makeController();
    workspaces.findById.mockResolvedValue({ id: 'ws-1' } as Workspace);
    workspaces.canUserAccessWorkspace.mockResolvedValue(false);

    await expect(controller.exportWorkspace(USER, 'ws-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(documents.exportWorkspaceZip).not.toHaveBeenCalled();
  });

  it('returns a 404 when the workspace does not exist', async () => {
    const { controller, workspaces } = makeController();
    workspaces.findById.mockResolvedValue(null);

    await expect(controller.exportWorkspace(USER, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets a member (any role, incl. viewer) export with correct ZIP headers', async () => {
    const { controller, documents, workspaces } = makeController();
    workspaces.findById.mockResolvedValue({ id: 'ws-1' } as Workspace);
    workspaces.canUserAccessWorkspace.mockResolvedValue(true);
    documents.exportWorkspaceZip.mockResolvedValue({
      buffer: Buffer.from('PK fake-zip'),
      filename: 'My Project.zip',
    });

    const result = await controller.exportWorkspace(USER, 'ws-1');

    expect(result).toBeInstanceOf(StreamableFile);
    const headers = result.getHeaders();
    expect(headers.type).toBe('application/zip');
    expect(headers.disposition).toBe('attachment; filename="My Project.zip"');
    expect(documents.exportWorkspaceZip).toHaveBeenCalledWith('ws-1');
  });
});
