import { IsEnum } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class UpdateMemberDto {
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
