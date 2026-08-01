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
  // Session lifetime. 7 days keeps users logged in across normal usage gaps;
  // sessions are still individually revocable server-side via the Session table.
  JWT_EXPIRES_IN: z.string().default('7d'),
  LOG_LEVEL: z.string().default('info'),
  DOC_TEARDOWN_GRACE_MS: z.coerce.number().int().positive().default(30000),
  SNAPSHOT_EVERY_N_UPDATES: z.coerce.number().int().positive().default(100),
  HTTP_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  HTTP_LIMIT: z.coerce.number().int().positive().default(120),
  AUTH_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  WS_MESSAGE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(50),
  WS_MAX_YJS_UPDATE_BYTES: z.coerce.number().int().positive().default(1_048_576),
  // Terminal
  ENABLE_TERMINAL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // When true or a hop count, Express trusts X-Forwarded-* for client IP
  // (needed for accurate per-IP throttling behind a reverse proxy).
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v, ctx) => {
      if (v === 'true') return true as const;
      if (v === 'false' || v === '') return false as const;
      const hops = Number(v);
      if (Number.isInteger(hops) && hops >= 1) return hops;
      ctx.addIssue({
        code: 'custom',
        message: 'TRUST_PROXY must be true, false, or a positive integer hop count',
      });
      return z.NEVER;
    }),
  // Multi-replica: fail readiness when Redis is not ok.
  REDIS_REQUIRED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Prefix Redis keys/channels (e.g. "prod" or "prod:" → "prod:").
  REDIS_KEY_PREFIX: z
    .string()
    .default('')
    .transform((v) => {
      const trimmed = v.trim();
      if (trimmed === '') return '';
      return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
    }),
  METRICS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  RESEND_API_KEY: z
    .string()
    .optional()
    .transform((v) => {
      const trimmed = v?.trim();
      return trimmed ? trimmed : undefined;
    }),
  MAIL_FROM: z.string().default('Meridian <no-reply@meridian.local>'),
  FORGOT_PASSWORD_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  EMAIL_VERIFICATION_REQUIRED: z.enum(['true', 'false']).optional(),
  EMAIL_VERIFICATION_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1440),
  E2E_TEST: z.enum(['true', 'false']).default('false'),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.E2E_TEST === 'true') {
    ctx.addIssue({
      code: 'custom',
      path: ['E2E_TEST'],
      message: 'E2E_TEST cannot be enabled in production',
    });
  }
  if (env.NODE_ENV === 'production' && env.ENABLE_TERMINAL) {
    ctx.addIssue({
      code: 'custom',
      path: ['ENABLE_TERMINAL'],
      message:
        'ENABLE_TERMINAL cannot be enabled in production without an isolated runner (see docs)',
    });
  }
  if (
    env.NODE_ENV === 'production' &&
    env.EMAIL_VERIFICATION_REQUIRED === 'false'
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_VERIFICATION_REQUIRED'],
      message: 'EMAIL_VERIFICATION_REQUIRED cannot be disabled in production',
    });
  }
  if (env.NODE_ENV === 'production' && env.RESEND_API_KEY === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['RESEND_API_KEY'],
      message: 'RESEND_API_KEY is required for production email verification',
    });
  }
  if (
    env.NODE_ENV === 'production' &&
    (/@(?:resend\.dev|meridian\.local)>?$/i.test(env.MAIL_FROM.trim()) ||
      !env.MAIL_FROM.includes('@'))
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_FROM'],
      message: 'MAIL_FROM must use a verified production mail domain',
    });
  }
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
