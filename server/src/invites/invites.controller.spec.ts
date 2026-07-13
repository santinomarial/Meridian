import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mockDeep } from 'jest-mock-extended';
import type { Invite } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { MailService } from '../modules/mail/mail.service';
import type { AuthUser } from '../modules/auth/types/auth-user.type';

const AUTH_USER: AuthUser = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  avatarUrl: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const INVITE: Invite = {
  id: 'invite-1',
  token: 'bearer-invite-token',
  workspaceId: 'ws-1',
  invitedById: 'owner-1',
  email: 'guest@example.com',
  role: WorkspaceRole.EDITOR,
  expiresAt: new Date('2030-01-01'),
  acceptedAt: null,
  createdAt: new Date('2024-01-01'),
};

describe('InvitesController.listInvites', () => {
  function makeController() {
    const invitesService = mockDeep<InvitesService>();
    const workspacesService = mockDeep<WorkspacesService>();
    const mailService = mockDeep<MailService>();
    const configService = mockDeep<ConfigService>();
    configService.getOrThrow.mockReturnValue({
      clientOrigin: 'http://localhost:5173',
    } as never);
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      assign: jest.fn(),
    };

    const controller = new InvitesController(
      invitesService,
      workspacesService,
      mailService,
      configService,
      logger as never,
    );
    return { controller, invitesService, workspacesService };
  }

  it('hides the workspace from a non-member', async () => {
    const { controller, invitesService, workspacesService } = makeController();
    workspacesService.getMemberRole.mockResolvedValue(null);

    await expect(controller.listInvites(AUTH_USER, 'ws-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(invitesService.listForWorkspace).not.toHaveBeenCalled();
  });

  it.each([WorkspaceRole.VIEWER, WorkspaceRole.EDITOR])(
    'does not expose bearer invite tokens to a %s',
    async (role) => {
      const { controller, invitesService, workspacesService } = makeController();
      workspacesService.getMemberRole.mockResolvedValue(role);

      await expect(controller.listInvites(AUTH_USER, 'ws-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(invitesService.listForWorkspace).not.toHaveBeenCalled();
    },
  );

  it('lets an owner list invites and their shareable URLs', async () => {
    const { controller, invitesService, workspacesService } = makeController();
    workspacesService.getMemberRole.mockResolvedValue(WorkspaceRole.OWNER);
    invitesService.listForWorkspace.mockResolvedValue([INVITE]);

    await expect(controller.listInvites(AUTH_USER, 'ws-1')).resolves.toEqual([
      expect.objectContaining({
        token: INVITE.token,
        inviteUrl: `http://localhost:5173/invite/${INVITE.token}`,
      }),
    ]);
  });
});
