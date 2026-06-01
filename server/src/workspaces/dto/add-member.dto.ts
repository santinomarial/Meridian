import { IsEnum, IsString } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class AddMemberDto {
  @IsString()
  userId!: string;

  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
