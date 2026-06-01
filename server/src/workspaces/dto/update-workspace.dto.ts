import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  name?: string;
}
