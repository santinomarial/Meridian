import { IsString, IsNotEmpty } from 'class-validator';

export class TerminalRunFileDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @IsString()
  @IsNotEmpty()
  documentId!: string;
}
