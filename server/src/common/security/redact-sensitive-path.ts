/**
 * Redacts bearer secrets that appear in URL path segments so access and
 * error logs never retain invite, verification, or password-reset tokens.
 */
export function redactSensitivePath(url: string): string {
  return url
    .replace(/(\/invites\/)[^/?#]+/gi, '$1[REDACTED]')
    .replace(/(\/verify-email\/)[^/?#]+/gi, '$1[REDACTED]')
    .replace(/(\/reset-password\/)[^/?#]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|inviteToken)=)[^&]*/gi, '$1[REDACTED]');
}
