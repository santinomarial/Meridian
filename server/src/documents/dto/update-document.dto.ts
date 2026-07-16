import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateDocumentDto {
  @ApiPropertyOptional({ example: 'auth.ts' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'src/services/auth.ts' })
  @IsString()
  @IsOptional()
  path?: string;

  @ApiPropertyOptional({ example: 'typescript', nullable: true })
  @IsString()
  @IsOptional()
  language?: string | null;

  @ApiPropertyOptional({ description: 'Move to a different parent folder', nullable: true })
  @IsString()
  @IsOptional()
  parentId?: string | null;

  @ApiPropertyOptional({
    example: 'export const x = 1;',
    nullable: true,
    deprecated: true,
    description:
      'Rejected. Use POST /documents/:id/checkpoint to save collaborative content.',
  })
  @IsString()
  @IsOptional()
  content?: string | null;
}
