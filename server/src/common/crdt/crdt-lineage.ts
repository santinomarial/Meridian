import { createHash } from 'crypto';
import * as Y from 'yjs';
import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// CRDT lineage helpers shared by the documents module (restore) and the
// realtime module (persistence, cold loads, seeding).
//
// A document's Yjs history belongs to exactly one *generation*
// (Document.crdtGeneration). Restore replaces the history with a brand-new
// lineage under the next generation; everything that writes or reads CRDT
// rows is scoped to a generation so stale replicas can never mix lineages.
// ---------------------------------------------------------------------------

/**
 * Serializes durable persistence lifecycle operations (update writes,
 * compaction, restore) for one document across all API processes. PostgreSQL
 * releases this transaction-scoped lock on commit, rollback, or connection
 * loss, so it cannot remain orphaned after a crash.
 */
export async function acquireDocumentLock(
  tx: Prisma.TransactionClient,
  documentId: string,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${documentId}, 0))
  `;
}

/**
 * Deterministic Yjs client id for server-seeded initial states.
 *
 * Two replicas may build the initial state for the same (document, generation)
 * concurrently; a deterministic client id makes both encodings byte-identical
 * so either replica can win the insert without producing divergent copies.
 *
 * The generation is part of the hash on purpose: each lineage seeds from a
 * different client id, so an update that referenced a pre-restore lineage can
 * never find its missing dependencies in a post-restore document and remains
 * inert instead of resurrecting old text.
 */
export function seedClientId(documentId: string, generation: number): number {
  const value = createHash('sha256')
    .update(`${documentId}:${generation}`)
    .digest()
    .readUInt32BE(0);
  return value === 0 ? 1 : value;
}

/**
 * Encodes the full Yjs state of a fresh document containing `content`,
 * seeded with the deterministic client id for (documentId, generation).
 * Used to build the seq-0 snapshot of a new lineage.
 */
export function encodeSeededState(
  documentId: string,
  generation: number,
  content: string,
): Uint8Array {
  const doc = new Y.Doc();
  try {
    doc.clientID = seedClientId(documentId, generation);
    if (content.length > 0) {
      doc.getText('content').insert(0, content);
    }
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * Projects the plain-text content of one CRDT generation from durable
 * Snapshot + DocumentUpdate rows. Returns `null` when that generation has no
 * history yet (bootstrap — callers use Document.content until the first seed).
 *
 * Does not read or write Document.content; the CRDT rows are the authority.
 */
export async function projectCrdtText(
  tx: Prisma.TransactionClient,
  documentId: string,
  generation: number,
): Promise<string | null> {
  const snapshot = await tx.snapshot.findFirst({
    where: { documentId, generation },
    orderBy: { seq: 'desc' },
    select: { seq: true, state: true },
  });
  const updates = await tx.documentUpdate.findMany({
    where: {
      documentId,
      generation,
      seq: { gt: snapshot?.seq ?? -1 },
    },
    orderBy: { seq: 'asc' },
    select: { update: true },
  });

  if (snapshot === null && updates.length === 0) {
    return null;
  }

  const doc = new Y.Doc();
  try {
    if (snapshot !== null) {
      Y.applyUpdate(doc, new Uint8Array(snapshot.state));
    }
    for (const row of updates) {
      Y.applyUpdate(doc, new Uint8Array(row.update));
    }
    return doc.getText('content').toString();
  } finally {
    doc.destroy();
  }
}
