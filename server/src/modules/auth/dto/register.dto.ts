import { IsEmail, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/validation/is-strong-password';

export class RegisterDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Must contain at least 8 characters, uppercase, lowercase, number, and special character' })
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ example: 'Alice', minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  displayName!: string;
}
