import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces/workspaces.module';
import { EditorGateway } from './editor.gateway';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { WsRateLimiter } from './ws-rate-limiter.service';

@Module({
  imports: [WorkspacesModule],
  providers: [
    EditorGateway,
    ConnectionRegistryService,
    DocumentManagerService,
    DocumentPersistenceService,
    WsRateLimiter,
  ],
  exports: [ConnectionRegistryService, DocumentManagerService, DocumentPersistenceService],
})
export class RealtimeModule {}
