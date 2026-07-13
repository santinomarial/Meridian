import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RealtimeAuthorizationModule } from '../modules/realtime-authorization/realtime-authorization.module';

@Module({
  imports: [RealtimeAuthorizationModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
