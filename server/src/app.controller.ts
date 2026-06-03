import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService, type ReadinessResponse } from './app.service';

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
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'Service liveness check — process is up' })
  @ApiOkResponse({ type: HealthResponse })
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks Postgres and Redis' })
  @ApiOkResponse({ description: 'All required dependencies are ready' })
  @ApiServiceUnavailableResponse({ description: 'One or more required dependencies are unavailable' })
  async getReady(): Promise<ReadinessResponse> {
    const readiness = await this.appService.getReadiness();
    if (readiness.status === 'not_ready') {
      throw new HttpException(readiness, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }
}
