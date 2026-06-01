import { Module } from '@nestjs/common';
import { EditorGateway } from './editor.gateway';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';

@Module({
  providers: [EditorGateway, ConnectionRegistryService, DocumentManagerService],
  exports: [ConnectionRegistryService, DocumentManagerService],
})
export class RealtimeModule {}
