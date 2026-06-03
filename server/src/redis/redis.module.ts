import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

// @Global makes RedisService injectable everywhere without each feature module
// needing to import RedisModule — same pattern as PrismaModule.
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
