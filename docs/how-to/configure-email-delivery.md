# Configure email delivery

Meridian sends account-verification, workspace-invitation, and password-reset
messages through Resend. Without a provider, development can return preview
action URLs. Production refuses to start without a provider and a sender on a
custom domain.

## 1. Prepare Resend

1. Verify a sending domain in Resend, including its required DNS records.
2. Create a restricted API key.
3. Choose a sender on the verified domain, for example
   `Meridian <invites@example.com>`.

The Resend testing domain (`@resend.dev`) can normally deliver only to the
Resend account owner. Do not use it as proof that invitations to other users
work.

## 2. Configure production

In the deployment's `.env`, set:

```dotenv
RESEND_API_KEY=re_...
MAIL_FROM="Meridian <accounts@example.com>"
CLIENT_ORIGIN=https://app.example.com
EMAIL_VERIFICATION_REQUIRED=true
EMAIL_VERIFICATION_TTL_MINUTES=1440
```

`CLIENT_ORIGIN` controls generated verification, invite, and reset URLs and
must exactly match the public HTTPS origin. Production validation rejects a
missing API key, a local or Resend testing sender domain, or disabled email
verification. Keep the API key in the deployment secret store; never commit or
print it.

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate api
docker compose -f docker-compose.prod.yml ps api
```

`config --quiet` must exit silently. Recreating the API disconnects active
clients and can interrupt process-local work, so ask users to save and schedule
the restart. `ps api` must show the replacement container healthy.

If it does not become healthy, inspect recent logs without copying secrets into
the command:

Working directory: repository root.

```bash
docker compose -f docker-compose.prod.yml logs --since=5m api
```

## 3. Verify delivery

Create a dedicated test account and exercise:

1. Registration, receipt of the verification message, and one successful
   verification.
2. Reuse of the same verification URL, which must be rejected.
3. One workspace invitation to a verified inbox outside the sending domain.
4. One password-reset request for the test account.

Confirm all three message types in the destination inbox and in Resend's
delivery log. Verification resend and password-reset endpoints intentionally
return generic responses, so those responses alone do not prove delivery. For
invite failures, Meridian still returns a copyable invite URL and reports a
delivery error.

Working directory: any directory.

```bash
curl -fsS "https://app.example.com/ready"
```

Replace the hostname before running. It must return HTTP 200 after the restart.
If mail fails, check API logs and Resend for sender-domain verification, rejected
recipients, or an invalid key; rotate any key that may have been exposed.

See [Server configuration](../reference/server/configuration.md) for mail and
token-lifetime variables.
