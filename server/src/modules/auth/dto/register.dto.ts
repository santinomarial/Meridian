import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/validation/is-strong-password';

export class RegisterDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Must contain at least 8 characters, uppercase, lowercase, number, and special character' })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ example: 'Alice' })
  @IsString()
  @MinLength(1)
  displayName!: string;
}
