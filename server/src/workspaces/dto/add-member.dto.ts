import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsString } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class AddMemberDto {
  @ApiProperty({ description: 'cuid of the user to add' })
  @IsString()
  userId!: string;

  @ApiProperty({
    enum: [WorkspaceRole.EDITOR, WorkspaceRole.VIEWER],
    example: WorkspaceRole.EDITOR,
  })
  @IsEnum(WorkspaceRole)
  @IsIn([WorkspaceRole.EDITOR, WorkspaceRole.VIEWER], {
    message: 'Members can only be added as EDITOR or VIEWER',
  })
  role!: WorkspaceRole;
}
