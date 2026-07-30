# Configure email delivery

Meridian sends workspace invitations and password-reset messages through
Resend. Without a provider, development prints action URLs; production records
a delivery failure.

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
MAIL_FROM="Meridian <invites@example.com>"
CLIENT_ORIGIN=https://app.example.com
```

`CLIENT_ORIGIN` controls generated invite and reset URLs and must exactly match
the public HTTPS origin. Keep the API key in the deployment secret store; never
commit or print it.

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

Create a dedicated test account and send:

1. One workspace invitation to an inbox outside the sending domain.
2. One password-reset request for the test account.

Confirm both messages in the destination inbox and in Resend's delivery log.
The password-reset endpoint intentionally returns a generic success response,
so that response alone does not prove delivery. For invite failures, Meridian
still returns a copyable invite URL and reports a delivery error.

Working directory: any directory.

```bash
curl -fsS "https://app.example.com/ready"
```

Replace the hostname before running. It must return HTTP 200 after the restart.
If mail fails, check API logs and Resend for sender-domain verification, rejected
recipients, or an invalid key; rotate any key that may have been exposed.

See [Server configuration](../reference/server/configuration.md) for mail
variables and reset-token lifetime.
