export interface AuthUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JwtPayload {
  sub: string;   // userId
  email: string;
  jti: string;   // session id used for revocation checks
}
