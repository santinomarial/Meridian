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
  };
});
