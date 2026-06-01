import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class LeaveDocumentDto {
  @ApiProperty()
  @IsString()
  documentId!: string;
}
