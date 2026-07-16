import { IsString, MaxLength } from 'class-validator';

/** Largest terminal input frame accepted by the application (UTF-16 code units). */
export const TERMINAL_INPUT_MAX_CHARS = 16_384;

export class TerminalInputDto {
  @IsString()
  @MaxLength(TERMINAL_INPUT_MAX_CHARS)
  data!: string;
}
