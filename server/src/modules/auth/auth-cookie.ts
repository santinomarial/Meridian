import type { CookieOptions } from 'express';

/** Name of the httpOnly session cookie. */
export const AUTH_COOKIE_NAME = 'auth_token';

/**
 * Options shared by every place that sets or clears the auth cookie
 * (AuthService on login/register/logout, JwtAuthGuard when discarding a
 * stale cookie). clearCookie must be called with the same options the
 * cookie was set with, or browsers will not remove it.
 */
export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
  };
}
