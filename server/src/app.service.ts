import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): {
    status: string;
    service: string;
    timestamp: string;
    uptime: number;
  } {
    return {
      status: 'ok',
      service: 'meridian-server',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
