import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsIn, IsOptional } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class CreateInviteDto {
  @ApiProperty({
    enum: [WorkspaceRole.EDITOR, WorkspaceRole.VIEWER],
    example: WorkspaceRole.EDITOR,
  })
  @IsEnum(WorkspaceRole)
  @IsIn([WorkspaceRole.EDITOR, WorkspaceRole.VIEWER], {
    message: 'Invites can only grant EDITOR or VIEWER roles',
  })
  role!: WorkspaceRole;

  @ApiPropertyOptional({
    description: 'When set, an invite email is sent to this address',
    example: 'colleague@example.com',
  })
  @IsEmail()
  @IsOptional()
  email?: string;
}
