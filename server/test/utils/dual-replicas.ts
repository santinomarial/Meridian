/**
 * Shared helpers for multi-replica integration tests.
 *
 * Boots two (or more) real Nest AppModules against the same PostgreSQL + Redis
 * without a load balancer. That exercises advisory locks, Redis fan-out,
 * restore control, and durable persistence across process-local rooms — the
 * data-integrity half of the multi-replica model. Sticky Socket.IO affinity
 * at an LB remains an ops/staging concern.
 */
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import type { AddressInfo } from 'net';
import {
  createTestApp,
  uniqueEmail,
  STRONG_PASSWORD,
  type TestApp,
} from './test-app';

export interface ReplicaPair {
  a: TestApp;
  b: TestApp;
}

export async function bootReplicaPair(): Promise<ReplicaPair> {
  const [a, b] = await Promise.all([createTestApp(), createTestApp()]);
  return { a, b };
}

export async function closeReplicaPair(pair: ReplicaPair): Promise<void> {
  await Promise.allSettled([pair.a.app.close(), pair.b.app.close()]);
}

/** Bind the Nest HTTP/Socket.IO server to an ephemeral port for socket clients. */
export async function listenTestApp(
  testApp: TestApp,
): Promise<TestApp & { port: number; url: string }> {
  await testApp.app.listen(0);
  const address = testApp.app.getHttpServer().address() as AddressInfo | null;
  if (address === null || typeof address.port !== 'number') {
    throw new Error('Failed to bind test app to an ephemeral port');
  }
  return {
    ...testApp,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
  };
}

export async function registerOwner(
  server: TestApp['server'],
  prefix: string,
  displayName = 'Multi-Replica Owner',
): Promise<{ agent: TestAgent; userId: string; token: string }> {
  const agent = request.agent(server);
  const res = await agent
    .post('/auth/register')
    .send({
      email: uniqueEmail(prefix),
      password: STRONG_PASSWORD,
      displayName,
    })
    .expect(201);
  return {
    agent,
    userId: res.body.user.id as string,
    token: res.body.token as string,
  };
}

/** Polls until `predicate` is true or `timeoutMs` elapses. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
