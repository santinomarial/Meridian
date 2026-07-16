import { Global, Injectable, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Counter,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import type { AppConfig } from '../../config/configuration.type';
import { APP_CONFIG_KEY } from '../../config/app.config';

export interface MetricsSnapshotSources {
  writeChainDepth: number;
  documentsLoaded: number;
  socketsActive: number;
  ptySessions: number;
  sandboxesActive: number;
}

/**
 * Process-local Prometheus registry. Counters are updated at call sites;
 * gauges are refreshed from {@link scrape} using live service snapshots so
 * this module does not depend on Realtime/Terminal (avoids Nest cycles).
 */
@Global()
@Injectable()
export class MetricsService {
  readonly enabled: boolean;
  private readonly registry: Registry;

  readonly persistCommits: Counter;
  readonly persistFailures: Counter;
  readonly persistFenced: Counter;

  private readonly writeChains: Gauge;
  private readonly documentsLoaded: Gauge;
  private readonly socketsActive: Gauge;
  private readonly ptySessions: Gauge;
  private readonly sandboxesActive: Gauge;

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.enabled = config.metricsEnabled;
    this.registry = new Registry();
    this.registry.setDefaultLabels({ service: 'meridian-server' });

    if (this.enabled) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.persistCommits = new Counter({
      name: 'meridian_persistence_commits_total',
      help: 'Durable Yjs updates committed to PostgreSQL',
      registers: [this.registry],
    });
    this.persistFailures = new Counter({
      name: 'meridian_persistence_failures_total',
      help: 'Durable Yjs update persistence failures (client should resend)',
      registers: [this.registry],
    });
    this.persistFenced = new Counter({
      name: 'meridian_persistence_fenced_total',
      help: 'Durable Yjs updates rejected by restore generation fencing',
      registers: [this.registry],
    });

    this.writeChains = new Gauge({
      name: 'meridian_persistence_write_chains',
      help: 'Documents with an in-flight local persistence write chain',
      registers: [this.registry],
    });
    this.documentsLoaded = new Gauge({
      name: 'meridian_documents_loaded',
      help: 'In-memory Y.Doc instances held by this process',
      registers: [this.registry],
    });
    this.socketsActive = new Gauge({
      name: 'meridian_sockets_active',
      help: 'Authenticated Socket.IO connections registered on this process',
      registers: [this.registry],
    });
    this.ptySessions = new Gauge({
      name: 'meridian_pty_sessions',
      help: 'Active node-pty terminal sessions on this process',
      registers: [this.registry],
    });
    this.sandboxesActive = new Gauge({
      name: 'meridian_sandboxes_active',
      help: 'Active terminal sandbox projections on this process',
      registers: [this.registry],
    });
  }

  recordPersistResult(status: 'committed' | 'failed' | 'fenced'): void {
    if (status === 'committed') this.persistCommits.inc();
    else if (status === 'failed') this.persistFailures.inc();
    else this.persistFenced.inc();
  }

  async scrape(sources: MetricsSnapshotSources): Promise<string> {
    this.writeChains.set(sources.writeChainDepth);
    this.documentsLoaded.set(sources.documentsLoaded);
    this.socketsActive.set(sources.socketsActive);
    this.ptySessions.set(sources.ptySessions);
    this.sandboxesActive.set(sources.sandboxesActive);
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}

@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
