import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

const RESET_TTL_MINUTES = 30; // kept in sync with FORGOT_PASSWORD_TTL_MINUTES default

@Injectable()
export class MailService {
  private readonly resendApiKey: string | undefined;
  private readonly mailFrom: string;
  private readonly isDev: boolean;

  constructor(
    configService: ConfigService,
    @InjectPinoLogger(MailService.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.resendApiKey = config.resendApiKey;
    this.mailFrom = config.mailFrom;
    this.isDev = config.nodeEnv === 'development';
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    if (this.resendApiKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.mailFrom,
          to: [to],
          subject: 'Reset your Meridian password',
          html: buildResetEmailHtml(resetUrl),
          text: buildResetEmailText(resetUrl),
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resend API error ${response.status}: ${body}`);
      }
      return;
    }

    if (this.isDev) {
      // Dev fallback: print the reset URL clearly so the developer can test without email.
      // eslint-disable-next-line no-console
      console.log(`\n${'─'.repeat(60)}\nDEV RESET URL: ${resetUrl}\n${'─'.repeat(60)}\n`);
      return;
    }

    // Production without a mail provider: fail internally so the error is logged
    // and monitored, but do NOT propagate — the caller (AuthService.forgotPassword)
    // always returns a generic success response to protect user enumeration.
    throw new Error(
      'No mail provider configured. Set RESEND_API_KEY in your production environment.',
    );
  }
}

// ---------------------------------------------------------------------------

function buildResetEmailText(resetUrl: string): string {
  return [
    'Hi,',
    '',
    'You requested a password reset for your Meridian account.',
    '',
    `Reset your password here:\n${resetUrl}`,
    '',
    `This link expires in ${RESET_TTL_MINUTES} minutes.`,
    '',
    'If you did not request this, you can safely ignore this email — your password will not change.',
    '',
    '— The Meridian Team',
  ].join('\n');
}

function buildResetEmailHtml(resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#0d0d0f;color:#e5e5ef;margin:0;padding:0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:40px auto">
    <tr><td style="background:#1a1a24;border:1px solid #2e2e42;border-radius:12px;padding:40px">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 16px;color:#e5e5ef">Reset your Meridian password</h1>
      <p style="color:#9a9ab8;margin:0 0 24px;line-height:1.6">
        You requested a password reset. Click the button below to choose a new password.
      </p>
      <a href="${resetUrl}"
         style="display:inline-block;background:#6d59f0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">
        Reset Password
      </a>
      <p style="color:#6b6b8a;font-size:13px;margin:24px 0 0;line-height:1.5">
        This link expires in <strong style="color:#9a9ab8">${RESET_TTL_MINUTES} minutes</strong>.<br>
        If you did not request this, you can safely ignore this email — your password will not change.
      </p>
      <hr style="border:none;border-top:1px solid #2e2e42;margin:24px 0">
      <p style="color:#6b6b8a;font-size:12px;margin:0">The Meridian Team</p>
    </td></tr>
  </table>
</body>
</html>`;
}
