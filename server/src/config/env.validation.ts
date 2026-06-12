import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  LOG_LEVEL: z.string().default('info'),
  DOC_TEARDOWN_GRACE_MS: z.coerce.number().int().positive().default(30000),
  SNAPSHOT_EVERY_N_UPDATES: z.coerce.number().int().positive().default(100),
  HTTP_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  HTTP_LIMIT: z.coerce.number().int().positive().default(120),
  AUTH_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  WS_MESSAGE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(50),
  WS_MAX_YJS_UPDATE_BYTES: z.coerce.number().int().positive().default(1_048_576),
  // Mail / password-reset
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Meridian <no-reply@meridian.local>'),
  FORGOT_PASSWORD_TTL_MINUTES: z.coerce.number().int().positive().default(30),
});

export type ValidatedEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): ValidatedEnv {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${messages}`);
  }

  return result.data;
}
