import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../../workspaces/workspaces.module';
import { TerminalGateway } from './terminal.gateway';
import { TerminalService } from './terminal.service';

@Module({
  imports: [WorkspacesModule],
  providers: [TerminalGateway, TerminalService],
})
export class TerminalModule {}
