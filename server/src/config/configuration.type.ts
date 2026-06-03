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
}
