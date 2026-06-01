import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Meridian' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'cuid of the owning user' })
  @IsString()
  ownerId!: string;
}
