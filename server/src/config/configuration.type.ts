export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  clientOrigin: string;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  logLevel: string;
  docTeardownGraceMs: number;
  snapshotEveryNUpdates: number;
  httpTtlSeconds: number;
  httpLimit: number;
  authTtlSeconds: number;
  authLimit: number;
  wsMessageLimitPerSecond: number;
  wsMaxYjsUpdateBytes: number;
  enableTerminal: boolean;
  /** Express trust proxy setting (false, true, or hop count). */
  trustProxy: boolean | number;
  /**
   * When true, `/ready` requires Redis `ok` (multi-replica deployments).
   * Single-replica topologies leave this false so Redis stays optional.
   */
  redisRequired: boolean;
  /**
   * Prefix applied to every Redis key and pub/sub channel so staging/prod
   * (or unrelated apps) can share a Redis deployment safely. Empty = none.
   * Normalized to always end with `:` when non-empty.
   */
  redisKeyPrefix: string;
  /** Expose Prometheus scrape endpoint at GET /metrics. */
  metricsEnabled: boolean;
  // Mail / password-reset
  resendApiKey: string | undefined;
  mailFrom: string;
  forgotPasswordTtlMinutes: number;
}
