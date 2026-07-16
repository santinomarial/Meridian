import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as Y from 'yjs';
import type { Server } from 'socket.io';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';

// ---------------------------------------------------------------------------
// Restore synchronization strategy
//
// A document has two parallel representations:
//   1. The plain-text `content` column (REST-managed, what versions store).
//   2. The Yjs CRDT history (DocumentUpdate/Snapshot rows + the in-memory
//      Y.Doc) that drives live collaborative editing.
//
// A naive restore that only rewrites `content` would leave any connected
// editor showing the stale Yjs text, and the next cold load would rebuild the
// old text from the CRDT history — silently discarding the restore.  So a
// correct restore must reconcile BOTH representations:
//
//   * If the document is live in memory, we mutate the canonical Y.Text inside
//     a Y transaction.  That produces an ordinary incremental CRDT update that
//     every connected client converges on cleanly (no destroy/rebind, no
//     divergent items) — we just broadcast it on the existing `yjs:update`
//     channel.  We then collapse the history into a single snapshot of the
//     restored state so cold loads reconstruct exactly what users now see.
//
//   * If the document is NOT in memory, there is no live Y.Doc to mutate.  We
//     drop the CRDT history entirely; the next collaborative open re-seeds the
//     Y.Doc from the restored `content` column.
//
// Finally we emit a `document:restored` event so clients can surface a
// notification and mark the tab clean.  The editor content itself updates via
// the Yjs update above — `document:restored` carries no text.
//
// PostgreSQL serializes durable persistence lifecycle operations across
// processes, but that does not make restore multi-instance safe. A complete
// design still needs to publish the restore update/event and fence stale Y.Doc
// writers on every other replica.
// ---------------------------------------------------------------------------

@Injectable()
export class DocumentRestoreService {
  // Set by EditorGateway.afterInit once Socket.IO is ready.  Restore can be
  // invoked before any socket connects (e.g. an HTTP restore with nobody
  // editing), in which case there is simply nothing to broadcast.
  private server: Server | null = null;

  constructor(
    private readonly documentManager: DocumentManagerService,
    private readonly persistence: DocumentPersistenceService,
    @InjectPinoLogger(DocumentRestoreService.name)
    private readonly logger: PinoLogger,
  ) {}

  /** Wires in the Socket.IO server so restores can be broadcast to clients. */
  registerServer(server: Server): void {
    this.server = server;
  }

  /**
   * Reconciles the realtime layer with a restored document content.
   * Safe to call whether or not the document is currently open by any client.
   */
  async applyRestore(documentId: string, content: string): Promise<void> {
    const doc = this.documentManager.getDoc(documentId);

    if (doc !== undefined) {
      // Live document: replace the canonical text within a transaction and
      // broadcast the resulting incremental update so peers converge.
      const before = Y.encodeStateVector(doc);
      const ytext = doc.getText('content');
      doc.transact(() => {
        if (ytext.length > 0) ytext.delete(0, ytext.length);
        if (content.length > 0) ytext.insert(0, content);
      }, 'restore');

      const diff = Y.encodeStateAsUpdate(doc, before);
      this.server
        ?.to(`document:${documentId}`)
        .emit('yjs:update', { documentId, update: diff });

      // Persist the restored state as the single source of truth for cold loads.
      const fullState = Y.encodeStateAsUpdate(doc);
      await this.persistence.resetDocument(documentId, fullState);

      this.logger.info(
        { documentId },
        'Applied restore to live document and broadcast update',
      );
    } else {
      // Not loaded: drop the CRDT history so the next open re-seeds from content.
      await this.persistence.resetDocument(documentId, null);
      this.logger.info(
        { documentId },
        'Applied restore to offline document — Yjs history reset',
      );
    }

    // Notify connected clients so they can mark the tab clean and toast.
    this.server
      ?.to(`document:${documentId}`)
      .emit('document:restored', { documentId });
  }
}
