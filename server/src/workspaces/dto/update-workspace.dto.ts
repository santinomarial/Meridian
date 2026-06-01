import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateWorkspaceDto {
  @ApiPropertyOptional({ example: 'Meridian v2' })
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;
}
