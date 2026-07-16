/**
 * Multi-replica CRDT generation / restore fencing completion test.
 *
 * Boots two NestJS AppModules against the same PostgreSQL + Redis and proves:
 *   1. Both replicas can load the same document (generation 0).
 *   2. A restore on replica A atomically bumps the generation and replaces
 *      CRDT history.
 *   3. Replica B receives the Redis restore-control event (or catches up via
 *      the generation audit) and evicts its stale Y.Doc.
 *   4. A persistence write tagged with the pre-restore generation is fenced
 *      out on both replicas — pre-restore state cannot reappear.
 *   5. Post-restore edits under the new generation persist cleanly.
 *
 * This is the completion criterion for document generations and restore
 * fencing: "open one document through two API replicas, restore it through
 * either replica, continue editing from both clients, and prove that no
 * pre-restore state reappears."
 */
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import * as Y from 'yjs';
import {
  createTestApp,
  cleanupByEmailPrefix,
  uniqueEmail,
  STRONG_PASSWORD,
  type TestApp,
} from './utils/test-app';
import { DocumentManagerService } from '../src/modules/realtime/document-manager.service';
import { DocumentPersistenceService } from '../src/modules/realtime/document-persistence.service';
import { DocumentRestoreService } from '../src/modules/realtime/document-restore.service';

const PREFIX = 'int-gen-';

async function registerOwner(server: TestApp['server']): Promise<{
  agent: TestAgent;
  userId: string;
}> {
  const agent = request.agent(server);
  const res = await agent
    .post('/auth/register')
    .send({
      email: uniqueEmail(PREFIX),
      password: STRONG_PASSWORD,
      displayName: 'Gen Fence Owner',
    })
    .expect(201);
  return { agent, userId: res.body.user.id as string };
}

/** Polls until `predicate` is true or `timeoutMs` elapses. */
async function waitFor(
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

function yText(doc: Y.Doc): string {
  return doc.getText('content').toString();
}

describe('CRDT generation restore fencing (multi-replica)', () => {
  let replicaA: TestApp;
  let replicaB: TestApp;
  let owner: TestAgent;
  let workspaceId: string;
  let documentId: string;
  let versionId: string;

  let managerA: DocumentManagerService;
  let managerB: DocumentManagerService;
  let persistenceA: DocumentPersistenceService;
  let persistenceB: DocumentPersistenceService;
  let restoreB: DocumentRestoreService;

  beforeAll(async () => {
    replicaA = await createTestApp();
    replicaB = await createTestApp();

    managerA = replicaA.app.get(DocumentManagerService);
    managerB = replicaB.app.get(DocumentManagerService);
    persistenceA = replicaA.app.get(DocumentPersistenceService);
    persistenceB = replicaB.app.get(DocumentPersistenceService);
    restoreB = replicaB.app.get(DocumentRestoreService);

    const reg = await registerOwner(replicaA.server);
    owner = reg.agent;

    const ws = await owner
      .post('/workspaces')
      .send({ name: 'Gen Fence WS' })
      .expect(201);
    workspaceId = ws.body.id;

    // Seed content that must NEVER reappear after restore.
    const doc = await owner
      .post(`/workspaces/${workspaceId}/documents`)
      .send({
        type: 'FILE',
        name: 'story.ts',
        path: 'story.ts',
        language: 'typescript',
        content: 'PRE_RESTORE_CONTENT',
      })
      .expect(201);
    documentId = doc.body.id;

    // Checkpoint is the only writer of Document.content. Build version 1 as
    // RESTORED_CONTENT, then checkpoint back to PRE_RESTORE so the live doc
    // differs from the restore source.
    const seedDoc = await managerA.acquire(documentId);
    seedDoc.getText('content').delete(0, seedDoc.getText('content').length);
    seedDoc.getText('content').insert(0, 'RESTORED_CONTENT');
    await persistenceA.persistUpdate(
      documentId,
      Y.encodeStateAsUpdate(seedDoc),
      0,
      'seed-restored-content',
    );
    await persistenceA.flushDocument(documentId);
    await owner.post(`/documents/${documentId}/checkpoint`).expect(201);

    seedDoc.getText('content').delete(0, seedDoc.getText('content').length);
    seedDoc.getText('content').insert(0, 'PRE_RESTORE_CONTENT');
    await persistenceA.persistUpdate(
      documentId,
      Y.encodeStateAsUpdate(seedDoc),
      0,
      'seed-pre-restore-content',
    );
    await persistenceA.flushDocument(documentId);
    await owner.post(`/documents/${documentId}/checkpoint`).expect(201);
    managerA.release(documentId);

    const versions = await owner
      .get(`/documents/${documentId}/versions`)
      .expect(200);
    // versions are newest-first; find the one that holds RESTORED_CONTENT.
    const restored = (
      versions.body as { id: string; versionNumber: number }[]
    ).find((v) => v.versionNumber === 1);
    if (restored === undefined) {
      throw new Error('Expected version 1 to exist after the first checkpoint');
    }
    versionId = restored.id;
  }, 60_000);

  afterAll(async () => {
    managerA.destroyAll();
    managerB.destroyAll();
    await cleanupByEmailPrefix(replicaA.prisma, PREFIX);
    await Promise.allSettled([replicaA.app.close(), replicaB.app.close()]);
  });

  it('restores across two replicas without resurrecting pre-restore state', async () => {
    // ── Both replicas open the live document (generation 0) ────────────────
    const docA = await managerA.acquire(documentId);
    const docB = await managerB.acquire(documentId);

    expect(managerA.getGeneration(documentId)).toBe(0);
    expect(managerB.getGeneration(documentId)).toBe(0);
    expect(yText(docA)).toBe('PRE_RESTORE_CONTENT');
    expect(yText(docB)).toBe('PRE_RESTORE_CONTENT');

    // Simulate a live edit on A under generation 0 and persist it.
    docA.getText('content').insert(docA.getText('content').length, '+LIVE');
    const liveUpdate = Y.encodeStateAsUpdate(docA);
    const preRestore = await persistenceA.persistUpdate(
      documentId,
      liveUpdate,
      0,
      'upd-pre-restore',
    );
    await persistenceA.flushDocument(documentId);
    expect(preRestore.status).toBe('committed');

    // ── Restore via replica A (HTTP) ───────────────────────────────────────
    const restoreRes = await owner
      .post(`/documents/${documentId}/versions/${versionId}/restore`)
      .expect(201);

    expect(restoreRes.body.document.crdtGeneration).toBe(1);
    expect(restoreRes.body.document.content).toBe('RESTORED_CONTENT');

    // Replica A reloaded locally as part of applyRestore.
    await waitFor(() => managerA.getGeneration(documentId) === 1);
    expect(yText(managerA.getDoc(documentId)!)).toBe('RESTORED_CONTENT');
    expect(yText(managerA.getDoc(documentId)!)).not.toContain('PRE_RESTORE');
    expect(yText(managerA.getDoc(documentId)!)).not.toContain('+LIVE');

    // ── Replica B converges via Redis control event (or audit fallback) ────
    try {
      await waitFor(() => managerB.getGeneration(documentId) === 1, 3_000);
    } catch {
      // If the Redis message was missed, the periodic audit (and this forced
      // pass) must still evict the stale lineage.
      await restoreB.auditGenerations();
      await waitFor(() => managerB.getGeneration(documentId) === 1, 3_000);
    }

    expect(yText(managerB.getDoc(documentId)!)).toBe('RESTORED_CONTENT');
    expect(yText(managerB.getDoc(documentId)!)).not.toContain('PRE_RESTORE');
    expect(yText(managerB.getDoc(documentId)!)).not.toContain('+LIVE');

    // ── Stale-generation writes are fenced on both replicas ────────────────
    const fencedB = await persistenceB.persistUpdate(
      documentId,
      liveUpdate,
      /* stale */ 0,
      'upd-stale-b',
    );
    await persistenceB.flushDocument(documentId);
    expect(fencedB.status).toBe('fenced');

    const fencedAStale = await persistenceA.persistUpdate(
      documentId,
      liveUpdate,
      /* stale */ 0,
      'upd-stale-a',
    );
    await persistenceA.flushDocument(documentId);
    expect(fencedAStale.status).toBe('fenced');

    // Confirm PostgreSQL still holds only the restored lineage — no
    // DocumentUpdate row under generation 0 can be written after the fence.
    const staleRows = await replicaA.prisma.documentUpdate.count({
      where: { documentId, generation: 0 },
    });
    // Generation 0 rows were deleted by the atomic restore; fencing prevents
    // any new ones. (A pre-restore live update may have landed before restore;
    // those rows are gone after restore deletes the old lineage.)
    expect(staleRows).toBe(0);

    // ── Post-restore edits under the new generation persist cleanly ────────
    const freshA = managerA.getDoc(documentId)!;
    freshA.getText('content').insert(freshA.getText('content').length, '+AFTER_A');
    await persistenceA.persistUpdate(
      documentId,
      Y.encodeStateAsUpdate(freshA),
      1,
      'upd-after-a',
    );
    await persistenceA.flushDocument(documentId);

    const freshB = managerB.getDoc(documentId)!;
    // Apply A's update into B's memory (as Redis fan-out would) then edit.
    Y.applyUpdate(freshB, Y.encodeStateAsUpdate(freshA));
    freshB.getText('content').insert(freshB.getText('content').length, '+AFTER_B');
    persistenceB.persistUpdate(
      documentId,
      Y.encodeStateAsUpdate(freshB),
      1,
      'upd-after-b',
    );
    await persistenceB.flushDocument(documentId);

    // Cold-load from DB on a throwaway manager path: acquire after release
    // rebuilds from the generation-1 snapshot + deltas.
    managerA.release(documentId);
    managerA.release(documentId); // drop to 0 so teardown can run after grace —
    // force immediate rebuild by destroyAll on A only and re-acquire.
    managerA.destroyAll();
    const reloaded = await managerA.acquire(documentId);
    expect(managerA.getGeneration(documentId)).toBe(1);
    const finalText = yText(reloaded);
    expect(finalText).toContain('RESTORED_CONTENT');
    expect(finalText).toContain('+AFTER_A');
    expect(finalText).toContain('+AFTER_B');
    expect(finalText).not.toContain('PRE_RESTORE');
    expect(finalText).not.toContain('+LIVE');

    managerA.release(documentId);
    managerB.release(documentId);
  }, 60_000);
});
