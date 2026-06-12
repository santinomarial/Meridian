import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/validation/is-strong-password';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Raw reset token from the URL' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ description: 'New password (must pass the full password policy)' })
  @IsStrongPassword()
  password!: string;
}
