import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

/** Outcome of attempting to deliver an email. */
export type MailSendResult =
  | { delivered: true }
  /** No provider / provider rejected — URL is safe to surface so the user can share it. */
  | {
      delivered: false;
      previewUrl: string;
      reason: "no_provider" | "testing_domain" | "provider_rejected";
      detail?: string;
    };

function isResendTestingFrom(mailFrom: string): boolean {
  return /@resend\.dev>?$/i.test(mailFrom.trim());
}

@Injectable()
export class MailService {
  private readonly resendApiKey: string | undefined;
  private readonly mailFrom: string;
  private readonly isDev: boolean;
  private readonly resetTtlMinutes: number;

  constructor(
    configService: ConfigService,
    @InjectPinoLogger(MailService.name)
    private readonly logger: PinoLogger,
  ) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.resendApiKey = config.resendApiKey;
    this.mailFrom = config.mailFrom;
    this.isDev = config.nodeEnv === "development";
    this.resetTtlMinutes = config.forgotPasswordTtlMinutes;

    if (this.resendApiKey && isResendTestingFrom(this.mailFrom)) {
      this.logger.warn(
        "MAIL_FROM uses @resend.dev — Resend will only deliver to your Resend account email. " +
          "Verify a domain at https://resend.com/domains and set MAIL_FROM to an address on that domain to invite other people.",
      );
    }
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<MailSendResult> {
    return this.send({
      to,
      subject: "Reset your Meridian password",
      html: buildResetEmailHtml(resetUrl, this.resetTtlMinutes),
      text: buildResetEmailText(resetUrl, this.resetTtlMinutes),
      previewUrl: resetUrl,
      action: "password-reset",
    });
  }

  async sendWorkspaceInviteEmail(
    to: string,
    inviterName: string,
    workspaceName: string,
    inviteUrl: string,
  ): Promise<MailSendResult> {
    return this.send({
      to,
      subject: `${inviterName} invited you to "${workspaceName}" on Meridian`,
      html: buildInviteEmailHtml(inviterName, workspaceName, inviteUrl),
      text: buildInviteEmailText(inviterName, workspaceName, inviteUrl),
      previewUrl: inviteUrl,
      action: "invite",
    });
  }

  private async send(message: {
    to: string;
    subject: string;
    html: string;
    text: string;
    previewUrl: string;
    action: string;
  }): Promise<MailSendResult> {
    if (this.resendApiKey) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.mailFrom,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(
          { status: response.status, action: message.action, to: message.to },
          `Resend API error ${response.status}`,
        );
        const testingDomain =
          isResendTestingFrom(this.mailFrom) ||
          /verify a domain|only send testing emails to your own/i.test(body);
        return {
          delivered: false,
          previewUrl: message.previewUrl,
          reason: testingDomain ? "testing_domain" : "provider_rejected",
          detail: body.slice(0, 300),
        };
      }
      return { delivered: true };
    }

    if (this.isDev) {
      this.logger.warn(
        { to: message.to, action: message.action, previewUrl: message.previewUrl },
        `No RESEND_API_KEY — ${message.action} link (dev only)`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `\n${"─".repeat(60)}\nDEV ${message.action.toUpperCase()} URL: ${message.previewUrl}\n${"─".repeat(60)}\n`,
      );
      return {
        delivered: false,
        previewUrl: message.previewUrl,
        reason: "no_provider",
      };
    }

    throw new Error(
      "No mail provider configured. Set RESEND_API_KEY in your production environment.",
    );
  }
}

// ---------------------------------------------------------------------------

function buildResetEmailText(resetUrl: string, ttlMinutes: number): string {
  return [
    'Hi,',
    '',
    'You requested a password reset for your Meridian account.',
    '',
    `Reset your password here:\n${resetUrl}`,
    '',
    `This link expires in ${ttlMinutes} minutes.`,
    '',
    'If you did not request this, you can safely ignore this email — your password will not change.',
    '',
    '— The Meridian Team',
  ].join('\n');
}

function buildInviteEmailText(
  inviterName: string,
  workspaceName: string,
  inviteUrl: string,
): string {
  return [
    'Hi,',
    '',
    `${inviterName} invited you to collaborate on "${workspaceName}" in Meridian.`,
    '',
    `Accept the invite here:\n${inviteUrl}`,
    '',
    'If you were not expecting this invite, you can safely ignore this email.',
    '',
    '— The Meridian Team',
  ].join('\n');
}

function buildInviteEmailHtml(
  inviterName: string,
  workspaceName: string,
  inviteUrl: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#0d0d0f;color:#e5e5ef;margin:0;padding:0">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:40px auto">
    <tr><td style="background:#1a1a24;border:1px solid #2e2e42;border-radius:12px;padding:40px">
      <h1 style="font-size:20px;font-weight:600;margin:0 0 16px;color:#e5e5ef">You're invited to collaborate</h1>
      <p style="color:#9a9ab8;margin:0 0 24px;line-height:1.6">
        <strong style="color:#e5e5ef">${escapeHtml(inviterName)}</strong> invited you to join
        <strong style="color:#e5e5ef">${escapeHtml(workspaceName)}</strong> on Meridian.
      </p>
      <a href="${inviteUrl}"
         style="display:inline-block;background:#6d59f0;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">
        Accept Invite
      </a>
      <p style="color:#6b6b8a;font-size:13px;margin:24px 0 0;line-height:1.5">
        If you were not expecting this invite, you can safely ignore this email.
      </p>
      <hr style="border:none;border-top:1px solid #2e2e42;margin:24px 0">
      <p style="color:#6b6b8a;font-size:12px;margin:0">The Meridian Team</p>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildResetEmailHtml(resetUrl: string, ttlMinutes: number): string {
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
        This link expires in <strong style="color:#9a9ab8">${ttlMinutes} minutes</strong>.<br>
        If you did not request this, you can safely ignore this email — your password will not change.
      </p>
      <hr style="border:none;border-top:1px solid #2e2e42;margin:24px 0">
      <p style="color:#6b6b8a;font-size:12px;margin:0">The Meridian Team</p>
    </td></tr>
  </table>
</body>
</html>`;
}
