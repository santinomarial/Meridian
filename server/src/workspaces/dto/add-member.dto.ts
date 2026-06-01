import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class AddMemberDto {
  @ApiProperty({ description: 'cuid of the user to add' })
  @IsString()
  userId!: string;

  @ApiProperty({ enum: WorkspaceRole, example: WorkspaceRole.EDITOR })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
