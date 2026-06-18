import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces/workspaces.module';
import { TerminalGateway } from './terminal.gateway';
import { TerminalService } from './terminal.service';
import { TerminalSandboxService } from './terminal-sandbox.service';

@Module({
  imports: [WorkspacesModule],
  providers: [TerminalGateway, TerminalService, TerminalSandboxService],
  // TerminalSandboxService is exported so the documents/realtime layers can
  // project DB mutations onto active terminal sandboxes (best-effort sync).
  exports: [TerminalSandboxService],
})
export class TerminalModule {}
