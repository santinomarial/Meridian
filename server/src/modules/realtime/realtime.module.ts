import { Module } from '@nestjs/common';
import { EditorGateway } from './editor.gateway';
import { ConnectionRegistryService } from './connection-registry.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';

@Module({
  providers: [
    EditorGateway,
    ConnectionRegistryService,
    DocumentManagerService,
    DocumentPersistenceService,
  ],
  exports: [ConnectionRegistryService, DocumentManagerService, DocumentPersistenceService],
})
export class RealtimeModule {}
