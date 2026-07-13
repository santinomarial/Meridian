import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { CreateDocumentDto } from './create-document.dto';

export class BulkCreateDocumentsDto {
  @ApiProperty({
    type: [CreateDocumentDto],
    description:
      'Documents to create, ordered so folders precede their contents. ' +
      'parentId is ignored — parents are resolved from each document path.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateDocumentDto)
  documents!: CreateDocumentDto[];
}
