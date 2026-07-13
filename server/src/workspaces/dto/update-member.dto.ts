import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class UpdateMemberDto {
  @ApiProperty({
    enum: [WorkspaceRole.EDITOR, WorkspaceRole.VIEWER],
    example: WorkspaceRole.VIEWER,
  })
  @IsEnum(WorkspaceRole)
  @IsIn([WorkspaceRole.EDITOR, WorkspaceRole.VIEWER], {
    message: 'Member roles can only be EDITOR or VIEWER',
  })
  role!: WorkspaceRole;
}
