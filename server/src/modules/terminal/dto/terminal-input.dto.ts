import { IsString } from 'class-validator';

export class TerminalInputDto {
  @IsString()
  data!: string;
}
