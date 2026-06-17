import { registerAs } from '@nestjs/config';
import { validateEnv } from './env.validation';
import type { AppConfig } from './configuration.type';

export const APP_CONFIG_KEY = 'app';

export const appConfig = registerAs(APP_CONFIG_KEY, (): AppConfig => {
  const env = validateEnv(process.env as Record<string, unknown>);

  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    clientOrigin: env.CLIENT_ORIGIN,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    logLevel: env.LOG_LEVEL,
    docTeardownGraceMs: env.DOC_TEARDOWN_GRACE_MS,
    snapshotEveryNUpdates: env.SNAPSHOT_EVERY_N_UPDATES,
    httpTtlSeconds: env.HTTP_TTL_SECONDS,
    httpLimit: env.HTTP_LIMIT,
    authTtlSeconds: env.AUTH_TTL_SECONDS,
    authLimit: env.AUTH_LIMIT,
    wsMessageLimitPerSecond: env.WS_MESSAGE_LIMIT_PER_SECOND,
    wsMaxYjsUpdateBytes: env.WS_MAX_YJS_UPDATE_BYTES,
    enableTerminal: env.ENABLE_TERMINAL,
    resendApiKey: env.RESEND_API_KEY,
    mailFrom: env.MAIL_FROM,
    forgotPasswordTtlMinutes: env.FORGOT_PASSWORD_TTL_MINUTES,
  };
});
