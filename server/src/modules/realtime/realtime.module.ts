import { Module } from '@nestjs/common';
import { EditorGateway } from './editor.gateway';
import { ConnectionRegistryService } from './connection-registry.service';

@Module({
  providers: [EditorGateway, ConnectionRegistryService],
  exports: [ConnectionRegistryService],
})
export class RealtimeModule {}
