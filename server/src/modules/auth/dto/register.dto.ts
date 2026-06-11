import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  email!: string;

  // TODO: Align backend password policy with frontend rules (uppercase, lowercase, number, special
  // character) before production deployment. Currently only enforces @MinLength(8).
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: 'Alice' })
  @IsString()
  @MinLength(1)
  displayName!: string;
}
