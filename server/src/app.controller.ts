import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

class HealthResponse {
  status!: string;
  service!: string;
  timestamp!: string;
  uptime!: number;
}

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @ApiOperation({ summary: 'Service liveness check' })
  @ApiOkResponse({ type: HealthResponse })
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
