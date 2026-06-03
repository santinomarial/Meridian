import type { Request } from 'express';
import type { AuthUser } from '../../modules/auth/types/auth-user.type';

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  sessionJti: string;
}
