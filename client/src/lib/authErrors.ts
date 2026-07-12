import { ApiError } from "./api";

export const AUTH_MESSAGES = {
  invalidCredentials: "Invalid email or password.",
  rateLimited: "Too many login attempts. Please wait and try again.",
  serverError: "Meridian hit a server error. Please try again.",
  serverUnreachable:
    "Unable to connect to Meridian. Please check that the server is running.",
} as const;

/**
 * Maps an error thrown during login/signup/reset into a clear, user-facing
 * message. Expected auth states (wrong password, rate limit, backend down)
 * each get a specific message — never a vague "Something went wrong".
 *
 * `invalidCredentialsFor401` should be true for login, where a 401 means the
 * credentials were wrong. Other flows (signup, reset) surface the backend's
 * own 4xx message, which is already user-appropriate (e.g. "Email already in
 * use", "Reset link is invalid or expired.").
 */
export function getAuthErrorMessage(
  err: unknown,
  { invalidCredentialsFor401 = false }: { invalidCredentialsFor401?: boolean } = {},
): string {
  if (err instanceof ApiError) {
    if (err.status === 401 && invalidCredentialsFor401) {
      return AUTH_MESSAGES.invalidCredentials;
    }
    if (err.status === 429) {
      return AUTH_MESSAGES.rateLimited;
    }
    if (err.status >= 500) {
      return AUTH_MESSAGES.serverError;
    }
    return err.message;
  }
  // fetch() rejects with a TypeError when the server is unreachable —
  // treat any non-API error in an auth flow as a connectivity problem.
  return AUTH_MESSAGES.serverUnreachable;
}
