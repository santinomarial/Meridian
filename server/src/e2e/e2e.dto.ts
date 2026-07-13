import { IsIn, IsString } from 'class-validator';
import { ALLOWED_TEST_EMAIL_PREFIXES } from './e2e-safety';

export class CleanupE2eUsersDto {
  @IsString()
  @IsIn(ALLOWED_TEST_EMAIL_PREFIXES)
  emailPrefix!: string;
}

export class E2eResetTokenDto {
  @IsString()
  email!: string;
}
