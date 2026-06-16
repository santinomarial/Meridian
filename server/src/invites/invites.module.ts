import { Module } from '@nestjs/common';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MailModule } from '../modules/mail/mail.module';

@Module({
  imports: [WorkspacesModule, MailModule],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
