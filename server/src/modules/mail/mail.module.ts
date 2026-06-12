import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { MailService } from './mail.service';

@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
