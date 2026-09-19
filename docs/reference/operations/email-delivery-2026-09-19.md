# Verified sender and delivery check — 2026-09-19

The user authorized live verification and password-reset tests to their Gmail inbox.
Both messages were sent from `Meridian <accounts@santinomarial.com>` after Resend
verified the domain's DNS records. The signed-in Resend Sending dashboard reported
**Delivered** for both messages (not merely HTTP acceptance).

- Verification delivery ID: `01a0ba09-413c-72f8-b219-1b2293e45034`.
- Password-reset delivery ID: `01a0ba09-4326-71dd-a986-390f25dac67b`.

The local account was already verified. The verification template was exercised
with a fresh, expiring verification token for that account; its verification
status and password were not reset. The password-reset message was requested
through `POST /auth/forgot-password`, which returned 200 without a preview URL.
No password-reset token was consumed and no password changed.

Links target the existing localhost client. Deployment must set CLIENT_ORIGIN to
the public HTTPS origin and repeat the complete account flow there. Provider
Delivered status confirms recipient-server acceptance; inbox placement and a
human clicking the messages have not been observed. No credentials or raw tokens
are stored in this record.
