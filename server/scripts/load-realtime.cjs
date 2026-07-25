#!/usr/bin/env node
'use strict';

const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
const Y = require('yjs');

const BASE_URL = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3100';
const CONCURRENCY_STAGES = (process.env.LOAD_CONCURRENCY ?? '10,25,50,100')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10));
const UPDATES_PER_USER = Number.parseInt(
  process.env.LOAD_UPDATES_PER_USER ?? '5',
  10,
);
const ACK_TIMEOUT_MS = Number.parseInt(
  process.env.LOAD_ACK_TIMEOUT_MS ?? '30000',
  10,
);
const PROVISION_BATCH_SIZE = Number.parseInt(
  process.env.LOAD_PROVISION_BATCH_SIZE ?? '5',
  10,
);
const PASSWORD = 'LoadTest@1234!';

function assertConfiguration() {
  const url = new URL(BASE_URL);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (
    !loopbackHosts.has(url.hostname) &&
    process.env.LOAD_ALLOW_REMOTE !== 'true'
  ) {
    throw new Error(
      `Refusing to load-test non-loopback target ${url.hostname}. ` +
        'Set LOAD_ALLOW_REMOTE=true only for an explicitly authorized environment.',
    );
  }
  if (
    CONCURRENCY_STAGES.length === 0 ||
    CONCURRENCY_STAGES.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 1000,
    )
  ) {
    throw new Error('LOAD_CONCURRENCY must contain integers from 1 through 1000');
  }
  if (!Number.isInteger(UPDATES_PER_USER) || UPDATES_PER_USER < 1) {
    throw new Error('LOAD_UPDATES_PER_USER must be a positive integer');
  }
  if (!Number.isInteger(ACK_TIMEOUT_MS) || ACK_TIMEOUT_MS < 1000) {
    throw new Error('LOAD_ACK_TIMEOUT_MS must be at least 1000');
  }
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function summarize(values) {
  if (values.length === 0) {
    return { min: null, p50: null, p95: null, p99: null, max: null, mean: null };
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: Math.max(...values),
    mean: total / values.length,
  };
}

function rounded(summary) {
  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [
      key,
      value === null ? null : Number(value.toFixed(2)),
    ]),
  );
}

async function api(path, options = {}) {
  const response = await fetch(new URL(path, BASE_URL), {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token
        ? { Authorization: `Bearer ${options.token}` }
        : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `${options.method ?? 'GET'} ${path} failed with ${response.status}: ${body}`,
    );
  }
  if (response.status === 204) return undefined;
  return response.json();
}

async function metrics() {
  const response = await fetch(new URL('/metrics', BASE_URL));
  if (!response.ok) {
    throw new Error(`/metrics failed with ${response.status}`);
  }
  const text = await response.text();
  const wanted = new Set([
    'process_cpu_user_seconds_total',
    'process_cpu_system_seconds_total',
    'process_resident_memory_bytes',
    'nodejs_heap_size_used_bytes',
    'nodejs_eventloop_lag_p99_seconds',
    'meridian_persistence_commits_total',
    'meridian_persistence_failures_total',
    'meridian_persistence_write_chains',
    'meridian_documents_loaded',
    'meridian_sockets_active',
  ]);
  const result = {};
  for (const line of text.split('\n')) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+(.+)$/.exec(
      line,
    );
    if (!match || !wanted.has(match[1])) continue;
    result[match[1]] = Number(match[2]);
  }
  return result;
}

async function registerUser(runId, index) {
  const registered = await api('/auth/register', {
    method: 'POST',
    body: {
      email: `load-${runId}-${index}@example.com`,
      password: PASSWORD,
      displayName: `Load User ${index}`,
    },
  });
  return {
    id: registered.user.id,
    token: registered.token,
  };
}

async function provisionUsers(owner, workspaceId, runId, count) {
  const users = [owner];
  for (let offset = 1; offset < count; offset += PROVISION_BATCH_SIZE) {
    const indexes = Array.from(
      { length: Math.min(PROVISION_BATCH_SIZE, count - offset) },
      (_, index) => offset + index,
    );
    const batch = await Promise.all(
      indexes.map((index) => registerUser(runId, index)),
    );
    await Promise.all(
      batch.map((user) =>
        api(`/workspaces/${workspaceId}/members`, {
          method: 'POST',
          token: owner.token,
          body: { userId: user.id, role: 'EDITOR' },
        }),
      ),
    );
    users.push(...batch);
    process.stdout.write(
      `\rProvisioned ${users.length}/${count} authenticated users`,
    );
  }
  process.stdout.write('\n');
  return users;
}

function waitForSocketEvent(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    };
    socket.once(event, onEvent);
  });
}

async function connectUser(user, documentId, stageState) {
  const connectedAt = performance.now();
  const socket = io(BASE_URL, {
    auth: { token: user.token },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: ACK_TIMEOUT_MS,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Socket connection timed out after ${ACK_TIMEOUT_MS}ms`));
    }, ACK_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
  }).catch((err) => {
    socket.close();
    throw err;
  });
  const connectLatencyMs = performance.now() - connectedAt;

  socket.on('yjs:update', () => {
    stageState.fanoutEvents += 1;
  });
  socket.on('error', (payload) => {
    stageState.serverErrors.push(
      typeof payload?.message === 'string'
        ? payload.message
        : JSON.stringify(payload),
    );
  });

  const joinedAt = performance.now();
  const joined = waitForSocketEvent(socket, 'joinedDocument', ACK_TIMEOUT_MS);
  socket.emit('joinDocument', { documentId });
  await joined;

  return {
    socket,
    ydoc: new Y.Doc(),
    pending: new Map(),
    connectLatencyMs,
    joinLatencyMs: performance.now() - joinedAt,
  };
}

function installAckHandlers(client) {
  client.socket.on('yjs:ack', (payload) => {
    const pending = client.pending.get(payload?.updateId);
    if (!pending) return;
    client.pending.delete(payload.updateId);
    clearTimeout(pending.timeout);
    pending.resolve(performance.now() - pending.startedAt);
  });
  client.socket.on('yjs:nack', (payload) => {
    const pending = client.pending.get(payload?.updateId);
    if (!pending) return;
    client.pending.delete(payload.updateId);
    clearTimeout(pending.timeout);
    pending.reject(new Error(payload?.reason ?? 'yjs:nack'));
  });
}

function createIncrementalUpdate(client, userIndex, updateIndex) {
  let update;
  const capture = (value) => {
    update = value;
  };
  client.ydoc.on('update', capture);
  const text = client.ydoc.getText('content');
  text.insert(text.length, `[${userIndex}:${updateIndex}]`);
  client.ydoc.off('update', capture);
  if (!update) throw new Error('Yjs did not produce an incremental update');
  return update;
}

function sendUpdate(client, documentId, userIndex, updateIndex) {
  const updateId = randomUUID();
  const update = createIncrementalUpdate(client, userIndex, updateIndex);
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      client.pending.delete(updateId);
      reject(new Error(`Ack timed out after ${ACK_TIMEOUT_MS}ms`));
    }, ACK_TIMEOUT_MS);
    client.pending.set(updateId, { startedAt, timeout, resolve, reject });
    client.socket.emit('yjs:update', { documentId, updateId, update });
  });
}

function closeClient(client) {
  for (const pending of client.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error('Socket closed'));
  }
  client.pending.clear();
  client.socket.close();
  client.ydoc.destroy();
}

async function runStage(owner, users, workspaceId, concurrency) {
  const filename = `load-${concurrency}-${randomUUID()}.txt`;
  const document = await api(`/workspaces/${workspaceId}/documents`, {
    method: 'POST',
    token: owner.token,
    body: {
      type: 'FILE',
      path: filename,
      name: filename,
      language: 'plaintext',
      content: '',
    },
  });

  const stageState = { fanoutEvents: 0, serverErrors: [] };
  const metricsBefore = await metrics();
  const connectionResults = await Promise.allSettled(
    users
      .slice(0, concurrency)
      .map((user) => connectUser(user, document.id, stageState)),
  );
  const clients = connectionResults
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const connectionFailures = connectionResults.filter(
    (result) => result.status === 'rejected',
  );
  if (connectionFailures.length > 0) {
    clients.forEach(closeClient);
    throw new Error(
      `${connectionFailures.length}/${concurrency} socket connections failed: ` +
        connectionFailures
          .slice(0, 3)
          .map((result) => String(result.reason))
          .join(' | '),
    );
  }
  clients.forEach(installAckHandlers);

  try {
    const connectLatency = clients.map((client) => client.connectLatencyMs);
    const joinLatency = clients.map((client) => client.joinLatencyMs);
    const ackLatency = [];
    const failures = [];
    const startedAt = performance.now();

    await Promise.all(
      clients.map(async (client, userIndex) => {
        for (
          let updateIndex = 0;
          updateIndex < UPDATES_PER_USER;
          updateIndex += 1
        ) {
          try {
            const latency = await sendUpdate(
              client,
              document.id,
              userIndex,
              updateIndex,
            );
            ackLatency.push(latency);
          } catch (err) {
            failures.push(String(err instanceof Error ? err.message : err));
            break;
          }
        }
      }),
    );

    const durationMs = performance.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const metricsAtPeak = await metrics();

    const expectedUpdates = concurrency * UPDATES_PER_USER;
    const expectedFanout = ackLatency.length * Math.max(0, concurrency - 1);
    return {
      concurrency,
      expectedUpdates,
      successfulUpdates: ackLatency.length,
      failedUsers: failures.length,
      durationMs: Number(durationMs.toFixed(2)),
      throughputPerSecond: Number(
        (ackLatency.length / (durationMs / 1000)).toFixed(2),
      ),
      connectLatencyMs: rounded(summarize(connectLatency)),
      joinLatencyMs: rounded(summarize(joinLatency)),
      ackLatencyMs: rounded(summarize(ackLatency)),
      fanoutEvents: stageState.fanoutEvents,
      expectedFanout,
      fanoutDeliveryRatio:
        expectedFanout === 0
          ? 1
          : Number((stageState.fanoutEvents / expectedFanout).toFixed(4)),
      serverErrors: stageState.serverErrors.slice(0, 10),
      failures: failures.slice(0, 10),
      resources: {
        residentMemoryMiB: Number(
          (
            (metricsAtPeak.process_resident_memory_bytes ?? 0) /
            1024 /
            1024
          ).toFixed(2),
        ),
        heapUsedMiB: Number(
          (
            (metricsAtPeak.nodejs_heap_size_used_bytes ?? 0) /
            1024 /
            1024
          ).toFixed(2),
        ),
        eventLoopLagP99Ms: Number(
          (
            (metricsAtPeak.nodejs_eventloop_lag_p99_seconds ?? 0) * 1000
          ).toFixed(2),
        ),
        cpuSeconds: Number(
          (
            (metricsAtPeak.process_cpu_user_seconds_total ?? 0) +
            (metricsAtPeak.process_cpu_system_seconds_total ?? 0) -
            (metricsBefore.process_cpu_user_seconds_total ?? 0) -
            (metricsBefore.process_cpu_system_seconds_total ?? 0)
          ).toFixed(3),
        ),
        socketsActive: metricsAtPeak.meridian_sockets_active ?? null,
        documentsLoaded: metricsAtPeak.meridian_documents_loaded ?? null,
        writeChainsAtScrape:
          metricsAtPeak.meridian_persistence_write_chains ?? null,
        persistenceFailuresDelta:
          (metricsAtPeak.meridian_persistence_failures_total ?? 0) -
          (metricsBefore.meridian_persistence_failures_total ?? 0),
      },
    };
  } finally {
    clients.forEach(closeClient);
  }
}

function printStage(result) {
  const ack = result.ackLatencyMs;
  console.log(`\n${result.concurrency} concurrent users`);
  console.log(
    `  updates: ${result.successfulUpdates}/${result.expectedUpdates} ` +
      `(${result.throughputPerSecond}/s), failed users: ${result.failedUsers}`,
  );
  console.log(
    `  ack ms: p50 ${ack.p50}, p95 ${ack.p95}, p99 ${ack.p99}, max ${ack.max}`,
  );
  console.log(
    `  connect p95: ${result.connectLatencyMs.p95} ms; ` +
      `join p95: ${result.joinLatencyMs.p95} ms`,
  );
  console.log(
    `  fan-out: ${result.fanoutEvents}/${result.expectedFanout} ` +
      `(${(result.fanoutDeliveryRatio * 100).toFixed(2)}%)`,
  );
  console.log(
    `  process: ${result.resources.residentMemoryMiB} MiB RSS, ` +
      `${result.resources.eventLoopLagP99Ms} ms event-loop p99, ` +
      `${result.resources.cpuSeconds} CPU seconds`,
  );
  if (result.serverErrors.length > 0) {
    console.log(`  server errors: ${result.serverErrors.join(' | ')}`);
  }
  if (result.failures.length > 0) {
    console.log(`  failures: ${result.failures.join(' | ')}`);
  }
}

async function main() {
  assertConfiguration();
  const health = await api('/ready');
  if (health.status !== 'ready') {
    throw new Error(`Target is not ready: ${JSON.stringify(health)}`);
  }

  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const maxConcurrency = Math.max(...CONCURRENCY_STAGES);
  console.log(
    `Target: ${BASE_URL}\nStages: ${CONCURRENCY_STAGES.join(', ')} users; ` +
      `${UPDATES_PER_USER} acknowledged updates per user`,
  );

  const owner = await registerUser(runId, 0);
  const workspace = await api('/workspaces', {
    method: 'POST',
    token: owner.token,
    body: { name: `Realtime load ${runId}` },
  });

  const results = [];
  try {
    const users = await provisionUsers(
      owner,
      workspace.id,
      runId,
      maxConcurrency,
    );
    for (const concurrency of CONCURRENCY_STAGES) {
      const result = await runStage(
        owner,
        users,
        workspace.id,
        concurrency,
      );
      results.push(result);
      printStage(result);
      if (result.failedUsers > 0 || result.resources.persistenceFailuresDelta > 0) {
        console.log('Stopping after the first stage with failures.');
        break;
      }
    }
  } finally {
    await api(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      token: owner.token,
    }).catch((err) => {
      console.error(`Workspace cleanup failed: ${err.message}`);
    });
  }

  console.log(`\nLOAD_RESULT_JSON=${JSON.stringify(results)}`);
  if (
    results.some(
      (result) =>
        result.failedUsers > 0 ||
        result.successfulUpdates !== result.expectedUpdates ||
        result.resources.persistenceFailuresDelta > 0,
    )
  ) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
