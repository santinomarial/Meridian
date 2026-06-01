import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'alice@meridian.dev' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Alice Chen' })
  @IsString()
  @MinLength(1)
  displayName!: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
