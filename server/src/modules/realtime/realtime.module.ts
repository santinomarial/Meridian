import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces/workspaces.module';
import { EditorGateway } from './editor.gateway';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';
import { DocumentRestoreService } from './document-restore.service';
import { WsRateLimiter } from './ws-rate-limiter.service';
import { RealtimeAuthorizationModule } from '../realtime-authorization/realtime-authorization.module';

@Module({
  imports: [WorkspacesModule, RealtimeAuthorizationModule],
  providers: [
    EditorGateway,
    ConnectionRegistryService,
    DocumentManagerService,
    DocumentPersistenceService,
    DocumentRestoreService,
    WsRateLimiter,
  ],
  exports: [
    ConnectionRegistryService,
    DocumentManagerService,
    DocumentPersistenceService,
    DocumentRestoreService,
  ],
})
export class RealtimeModule {}
