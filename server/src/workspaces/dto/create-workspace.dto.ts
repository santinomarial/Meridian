import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Meridian' })
  @IsString()
  @MinLength(1)
  name!: string;

  /**
   * Deprecated — the owner is always the authenticated user. Accepted for
   * backwards compatibility with older clients but ignored by the server.
   */
  @ApiPropertyOptional({ description: 'Ignored; owner is the authenticated user' })
  @IsString()
  @IsOptional()
  ownerId?: string;
}
