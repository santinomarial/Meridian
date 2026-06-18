import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { RealtimeModule } from '../modules/realtime/realtime.module';
import { TerminalModule } from '../modules/terminal/terminal.module';

@Module({
  imports: [WorkspacesModule, RealtimeModule, TerminalModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
