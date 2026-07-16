import type { Params } from 'nestjs-pino';
import type { AppConfig } from './configuration.type';
import { redactSensitivePath } from '../common/security/redact-sensitive-path';

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.token',
  'res.headers["set-cookie"]',
];

export function buildLoggerParams(config: AppConfig): Params {
  const isDev = config.nodeEnv === 'development';

  return {
    pinoHttp: {
      level: config.logLevel,
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
      genReqId(req) {
        const existing =
          (req.headers['x-request-id'] as string | undefined) ?? '';
        if (existing) return existing;
        return crypto.randomUUID();
      },
      customProps(req) {
        return { requestId: req.id };
      },
      serializers: {
        req(req: { method: string; url: string; id: string }) {
          return {
            method: req.method,
            url: redactSensitivePath(req.url),
            requestId: req.id,
          };
        },
      },
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: false,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  };
}
