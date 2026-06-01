import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class UpdateMemberDto {
  @ApiProperty({ enum: WorkspaceRole, example: WorkspaceRole.VIEWER })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
