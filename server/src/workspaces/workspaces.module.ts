import { Module } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { WorkspacesController } from './workspaces.controller';
import { RealtimeAuthorizationModule } from '../modules/realtime-authorization/realtime-authorization.module';

@Module({
  imports: [RealtimeAuthorizationModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
