import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { RealtimeModule } from '../modules/realtime/realtime.module';

@Module({
  imports: [WorkspacesModule, RealtimeModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
