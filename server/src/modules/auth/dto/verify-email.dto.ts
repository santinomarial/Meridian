import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Raw one-time token from the verification URL' })
  @IsString()
  @MinLength(1)
  token!: string;
}
