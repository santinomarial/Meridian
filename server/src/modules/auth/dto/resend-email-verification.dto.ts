import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendEmailVerificationDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;
}
