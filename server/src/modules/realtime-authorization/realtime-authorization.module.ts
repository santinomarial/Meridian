import { Global, Module } from '@nestjs/common';
import { RealtimeAuthorizationService } from './realtime-authorization.service';

/**
 * Shared security boundary for long-lived Socket.IO connections.
 *
 * The module is global because authentication, workspace mutations, the
 * editor gateway, and the terminal gateway all need to publish or consume the
 * same revocation signal without introducing feature-module cycles.
 */
@Global()
@Module({
  providers: [RealtimeAuthorizationService],
  exports: [RealtimeAuthorizationService],
})
export class RealtimeAuthorizationModule {}
