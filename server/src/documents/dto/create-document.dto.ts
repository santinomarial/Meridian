import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { DocumentType } from '@prisma/client';

export class CreateDocumentDto {
  @IsString()
  @IsOptional()
  parentId?: string;

  @IsEnum(DocumentType)
  type!: DocumentType;

  @IsString()
  @MinLength(1)
  path!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  content?: string;
}
