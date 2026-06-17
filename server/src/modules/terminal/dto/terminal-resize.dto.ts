import { IsInt, Min, Max } from 'class-validator';

export class TerminalResizeDto {
  @IsInt()
  @Min(1)
  @Max(500)
  cols!: number;

  @IsInt()
  @Min(1)
  @Max(200)
  rows!: number;
}
