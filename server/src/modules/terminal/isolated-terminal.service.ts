import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { APP_CONFIG_KEY } from '../../config/app.config';
import type { AppConfig } from '../../config/configuration.type';
import type { IDisposable } from 'node-pty';
import { assertSafeRelPath } from './path-safety';

export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): IDisposable;
  onExit(listener: (event: { exitCode: number }) => void): IDisposable;
}

/** Authenticated, private worker transport. User code never runs on the API. */
@Injectable()
export class IsolatedTerminalService {
  readonly enabled: boolean;
  private readonly url: string;
  private readonly token: string;
  private readonly production: boolean;
  private readonly roots = new Map<string, string>();

  constructor(configService: ConfigService) {
    const config = configService.getOrThrow<AppConfig>(APP_CONFIG_KEY);
    this.enabled = config.enableTerminal && config.terminalBackend === 'isolated';
    this.url = config.terminalRunnerUrl ?? '';
    this.token = config.terminalRunnerToken ?? '';
    this.production = config.nodeEnv === 'production';
  }

  async request<T>(path: string, method = 'GET', body?: unknown, timeoutMs = 25_000): Promise<T> {
    const response = await fetch(`${this.url}${path}`, {
      method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
    // Bound untrusted worker output before parsing or creating documents.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Terminal worker returned no response');
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 30 * 1024 * 1024) throw new Error('Terminal worker response exceeds limits');
        chunks.push(next.value);
      }
    } finally { await reader.cancel(); }
    if (!response.ok) {
      if (response.status === 429) throw new Error('Terminal capacity reached. Close another terminal and retry.');
      throw new Error('Terminal worker unavailable. Please reconnect the terminal.');
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  }

  async health(): Promise<void> {
    const result = await this.request<{ isolation: string; ready: boolean }>('/health', 'GET', undefined, 2_000);
    if (this.production && result.isolation !== 'gvisor') throw new Error('Production terminal requires an isolated worker');
    if (!result.ready) throw new Error('Terminal worker is not ready');
  }

  async create(root: string, workspaceId: string, userId: string, files: Record<string, string>, folders: string[]): Promise<void> {
    await this.health();
    const result = await this.request<{ id: string }>('/sandboxes', 'POST', { workspaceId, userId, files, folders });
    if (!/^[a-f0-9-]{36}$/.test(result.id)) throw new Error('Invalid terminal worker response');
    this.roots.set(root, result.id);
  }

  private id(root: string): string {
    const id = this.roots.get(root);
    if (!id) throw new Error('Terminal sandbox is unavailable');
    return id;
  }

  async files(root: string): Promise<Map<string, string>> {
    const result = await this.request<{ files: Record<string, string> }>(`/sandboxes/${this.id(root)}/files`, 'POST', { op: 'snapshot' });
    if (!result.files || typeof result.files !== 'object' || Array.isArray(result.files)) throw new Error('Invalid terminal snapshot');
    const entries = Object.entries(result.files);
    let total = 0;
    if (entries.length > 1000) throw new Error('Terminal file count exceeds limits');
    for (const [name, content] of entries) {
      if (assertSafeRelPath(name) !== name || Buffer.byteLength(name) > 4096 || typeof content !== 'string') throw new Error('Invalid terminal file');
      const bytes = Buffer.byteLength(content);
      total += bytes;
      if (bytes > 1024 * 1024 || total > 25 * 1024 * 1024 || content.includes('\0')) throw new Error('Terminal file exceeds limits');
    }
    return new Map(entries);
  }

  async apply(root: string, operation: Record<string, unknown>): Promise<boolean> {
    const result = await this.request<{ applied: boolean }>(`/sandboxes/${this.id(root)}/files`, 'POST', operation);
    if (typeof result.applied !== 'boolean') throw new Error('Invalid terminal file result');
    return result.applied;
  }

  async destroy(root: string): Promise<void> {
    const id = this.roots.get(root);
    if (!id) return;
    await this.request(`/sandboxes/${id}`, 'DELETE');
    this.roots.delete(root);
  }

  async spawn(root: string): Promise<TerminalProcess> {
    const result = await this.request<{ id: string }>(`/sandboxes/${this.id(root)}/terminals`, 'POST', {});
    if (!/^[a-f0-9-]{36}$/.test(result.id)) throw new Error('Invalid terminal session');
    return new WorkerTerminal(this, result.id);
  }
}

class WorkerTerminal implements TerminalProcess {
  private readonly events = new EventEmitter();
  private stopped = false;
  private polling = false;
  private timer: NodeJS.Timeout;
  private pending = Promise.resolve();
  private queuedBytes = 0;

  constructor(private readonly runner: IsolatedTerminalService, private readonly id: string) {
    this.timer = setInterval(() => { void this.poll(); }, 100);
    this.timer.unref();
  }
  private async poll(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      const result = await this.runner.request<{ data: string; exitCode: number | null }>(`/terminals/${this.id}`);
      if (this.stopped) return;
      if (typeof result.data !== 'string' || Buffer.byteLength(result.data) > 262144 || (result.exitCode !== null && !Number.isInteger(result.exitCode))) throw new Error('Invalid terminal output');
      if (result.data) this.events.emit('data', result.data);
      if (result.exitCode !== null) this.exit(result.exitCode);
    } catch { this.fail(); }
    finally { this.polling = false; }
  }
  private exit(code: number): void {
    if (this.stopped) return;
    this.stopped = true; clearInterval(this.timer); this.events.emit('exit', { exitCode: code });
  }
  private fail(): void {
    if (!this.stopped) this.events.emit('data', '\r\n[Meridian] Terminal connection lost. Reconnect to continue.\r\n');
    this.exit(1);
  }
  private send(action: string, body: unknown): void {
    if (this.stopped) throw new Error('Terminal stopped');
    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (this.queuedBytes + bytes > 262144) { this.fail(); throw new Error('Terminal input queue full'); }
    this.queuedBytes += bytes;
    this.pending = this.pending.then(async () => {
      if (!this.stopped) await this.runner.request(`/terminals/${this.id}/${action}`, 'POST', body);
    }).catch(() => this.fail()).finally(() => { this.queuedBytes -= bytes; });
  }
  write(data: string): void { this.send('input', { data }); }
  resize(cols: number, rows: number): void { this.send('resize', { cols, rows }); }
  kill(): void {
    this.stopped = true; clearInterval(this.timer);
    void this.runner.request(`/terminals/${this.id}`, 'DELETE').catch(() => {});
  }
  onData(listener: (data: string) => void): IDisposable {
    this.events.on('data', listener); return { dispose: () => { this.events.off('data', listener); } };
  }
  onExit(listener: (event: { exitCode: number }) => void): IDisposable {
    this.events.on('exit', listener); return { dispose: () => { this.events.off('exit', listener); } };
  }
}
