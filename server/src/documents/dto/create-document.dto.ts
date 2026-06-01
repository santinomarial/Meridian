import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { DocumentType } from '@prisma/client';

export class CreateDocumentDto {
  @ApiPropertyOptional({ description: 'Parent document id (folder)' })
  @IsString()
  @IsOptional()
  parentId?: string;

  @ApiProperty({ enum: DocumentType, example: DocumentType.FILE })
  @IsEnum(DocumentType)
  type!: DocumentType;

  @ApiProperty({ example: 'src/services/auth.ts' })
  @IsString()
  @MinLength(1)
  path!: string;

  @ApiProperty({ example: 'auth.ts' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ example: 'typescript' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ example: 'export {};' })
  @IsString()
  @IsOptional()
  content?: string;
}
