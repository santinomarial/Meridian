import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces/workspaces.module';
import { TerminalGateway } from './terminal.gateway';
import { TerminalService } from './terminal.service';
import { TerminalSandboxService } from './terminal-sandbox.service';
import { RealtimeAuthorizationModule } from '../realtime-authorization/realtime-authorization.module';
import { WsRateLimiter } from '../realtime/ws-rate-limiter.service';

@Module({
  imports: [WorkspacesModule, RealtimeAuthorizationModule],
  providers: [
    TerminalGateway,
    TerminalService,
    TerminalSandboxService,
    // Terminal events have an independent per-socket budget. Keeping this
    // provider local also avoids coupling terminal execution to RealtimeModule.
    WsRateLimiter,
  ],
  // TerminalSandboxService is exported so the documents/realtime layers can
  // project DB mutations onto active terminal sandboxes (best-effort sync).
  exports: [TerminalSandboxService, TerminalService],
})
export class TerminalModule {}
