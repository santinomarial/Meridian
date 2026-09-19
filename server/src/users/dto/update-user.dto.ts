import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
  @ApiPropertyOptional({ example: 'Alice Chen', minLength: 1, maxLength: 100 })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png', nullable: true })
  @IsString()
  @IsOptional()
  avatarUrl?: string | null;
}
