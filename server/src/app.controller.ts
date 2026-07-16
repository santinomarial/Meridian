import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService, type ReadinessResponse } from './app.service';
import { MetricsService } from './common/metrics/metrics.module';
import { DocumentPersistenceService } from './modules/realtime/document-persistence.service';
import { DocumentManagerService } from './modules/realtime/document-manager.service';
import { ConnectionRegistryService } from './modules/realtime/connection-registry.service';
import { TerminalService } from './modules/terminal/terminal.service';
import { TerminalSandboxService } from './modules/terminal/terminal-sandbox.service';

class HealthResponse {
  status!: string;
  service!: string;
  timestamp!: string;
  uptime!: number;
}

// Health and readiness probes are internal infrastructure endpoints.
// They are exempt from the 'auth' throttler (which targets login/register)
// but still governed by the 'default' throttler as a basic sanity guard.
@SkipThrottle({ auth: true })
@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly metrics: MetricsService,
    private readonly persistence: DocumentPersistenceService,
    private readonly documentManager: DocumentManagerService,
    private readonly connectionRegistry: ConnectionRegistryService,
    private readonly terminals: TerminalService,
    private readonly sandboxes: TerminalSandboxService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Service liveness check — process is up' })
  @ApiOkResponse({ type: HealthResponse })
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks Postgres and Redis' })
  @ApiOkResponse({ description: 'All required dependencies are ready' })
  @ApiServiceUnavailableResponse({
    description: 'One or more required dependencies are unavailable',
  })
  async getReady(): Promise<ReadinessResponse> {
    const readiness = await this.appService.getReadiness();
    if (readiness.status === 'not_ready') {
      throw new HttpException(readiness, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics scrape endpoint' })
  @ApiOkResponse({ description: 'Prometheus text exposition format' })
  async getMetrics(): Promise<string> {
    if (!this.metrics.enabled) {
      throw new NotFoundException();
    }
    return this.metrics.scrape({
      writeChainDepth: this.persistence.writeChainDepth(),
      documentsLoaded: this.documentManager.size(),
      socketsActive: this.connectionRegistry.size(),
      ptySessions: this.terminals.sessionCount(),
      sandboxesActive: this.sandboxes.activeCount(),
    });
  }
}
