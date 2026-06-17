import { IsString, IsNotEmpty } from 'class-validator';

export class TerminalStartDto {
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;
}
