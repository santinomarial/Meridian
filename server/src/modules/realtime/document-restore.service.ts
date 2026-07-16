import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { DocumentManagerService } from './document-manager.service';
import { DocumentPersistenceService } from './document-persistence.service';

// ---------------------------------------------------------------------------
// Restore synchronization strategy
//
// A version restore replaces a document's CRDT history with a brand-new
// lineage: DocumentsService.restoreVersion atomically (under the document
// advisory lock) increments Document.crdtGeneration, rewrites content,
// records the restored version, and swaps the Yjs rows for a single seq-0
// snapshot of the restored text.
//
// The old lineage is dead the moment that transaction commits.  Three
// mechanisms make every replica and client converge on the new one:
//
//   1. Restore-control event.  The handling replica evicts/reloads its own
//      Y.Doc and publishes {documentId, generation} on Redis.  Every other
//      replica does the same on receipt, then tells connected clients to
//      resynchronize via `document:restored` (clients discard their local
//      Y.Doc and re-run the join/sync handshake).
//
//   2. Persistence fencing.  Every durable write re-reads crdtGeneration
//      inside its locked transaction and is rejected on mismatch, so a
//      replica that has not yet processed the control event can never commit
//      pre-restore state (see DocumentPersistenceService).
//
//   3. Periodic audit.  Every GENERATION_AUDIT_MS this service compares the
//      generation of each loaded Y.Doc against PostgreSQL and evicts stale
//      ones, so a missed Redis message cannot leave a replica serving a dead
//      lineage indefinitely.
// ---------------------------------------------------------------------------

const RESTORE_CHANNEL_PATTERN = 'document:*:restore';

function restoreChannel(documentId: string): string {
  return `document:${documentId}:restore`;
}

interface RestoreControlMessage {
  originId: string;
  documentId: string;
  generation: number;
}

export const GENERATION_AUDIT_MS = 15_000;

@Injectable()
export class DocumentRestoreService implements OnModuleInit, OnModuleDestroy {
  // Set by EditorGateway.afterInit once Socket.IO is ready.  Restore can be
  // invoked before any socket connects (e.g. an HTTP restore with nobody
  // editing), in which case there is simply nothing to broadcast.
  private server: Server | null = null;

  // Per-instance (not per-module) so sibling replicas booted in the same
  // process — as in the multi-replica integration harness — still treat each
  // other's control messages as remote.
  private readonly originId = randomUUID();

  private auditTimer: NodeJS.Timeout | undefined;
  private auditRunning = false;

  constructor(
    private readonly documentManager: DocumentManagerService,
    private readonly persistence: DocumentPersistenceService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(DocumentRestoreService.name)
    private readonly logger: PinoLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redis.subscribe(RESTORE_CHANNEL_PATTERN, (_channel, message) =>
      this.onRedisRestore(message as string),
    );
    this.auditTimer = setInterval(() => {
      void this.auditGenerations();
    }, GENERATION_AUDIT_MS);
    this.auditTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.auditTimer !== undefined) {
      clearInterval(this.auditTimer);
      this.auditTimer = undefined;
    }
    await this.redis.unsubscribe(RESTORE_CHANNEL_PATTERN);
  }

  /** Wires in the Socket.IO server so restores can be broadcast to clients. */
  registerServer(server: Server): void {
    this.server = server;
  }

  /**
   * Reconciles the realtime layer after DocumentsService.restoreVersion
   * committed generation `generation`: evicts the local Y.Doc, resyncs local
   * clients, and publishes the restore-control event so every other replica
   * does the same. Safe to call whether or not the document is loaded.
   */
  async applyRestore(documentId: string, generation: number): Promise<void> {
    await this.evictAndResync(documentId, generation);

    const payload: RestoreControlMessage = {
      originId: this.originId,
      documentId,
      generation,
    };
    await this.redis.publish(
      restoreChannel(documentId),
      JSON.stringify(payload),
    );

    this.logger.info(
      { documentId, generation },
      'Applied restore and published restore-control event',
    );
  }

  /**
   * Compares every loaded Y.Doc's generation against PostgreSQL and evicts
   * stale ones. Runs on an interval; public so tests (and operators) can
   * force a pass.
   */
  async auditGenerations(): Promise<void> {
    if (this.auditRunning) return;
    this.auditRunning = true;
    try {
      const documentIds = this.documentManager.loadedDocumentIds();
      if (documentIds.length === 0) return;

      const rows = await this.prisma.document.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, crdtGeneration: true },
      });

      for (const row of rows) {
        const loaded = this.documentManager.getGeneration(row.id);
        if (loaded === undefined || loaded === row.crdtGeneration) continue;

        this.logger.warn(
          { documentId: row.id, loaded, current: row.crdtGeneration },
          'Generation audit found stale document — evicting and resyncing',
        );
        await this.evictAndResync(row.id, row.crdtGeneration);
      }
    } catch (err) {
      this.logger.error({ err }, 'Generation audit failed');
    } finally {
      this.auditRunning = false;
    }
  }

  /**
   * Resynchronizes one document against the generation currently committed in
   * PostgreSQL. Used when a fenced persistence write reveals that this
   * replica missed a restore, without waiting for the periodic audit.
   */
  async resyncFromDatabase(documentId: string): Promise<void> {
    try {
      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { crdtGeneration: true },
      });
      if (document === null) return;
      if (this.documentManager.getGeneration(documentId) === document.crdtGeneration) {
        return;
      }
      await this.evictAndResync(documentId, document.crdtGeneration);
    } catch (err) {
      this.logger.error(
        { err, documentId },
        'Failed to resync document after fenced persistence write',
      );
    }
  }

  /**
   * Evicts the stale local Y.Doc (rebuilding it from the new lineage when it
   * is loaded) and tells connected local clients to resynchronize.
   */
  async evictAndResync(documentId: string, generation: number): Promise<void> {
    this.persistence.handleGenerationChange(documentId, generation);

    if (this.documentManager.hasDocument(documentId)) {
      await this.documentManager.reload(documentId);
    }

    // Clients discard their local Y.Doc and re-run the join/sync handshake in
    // response; the payload's generation lets them ignore duplicate events.
    this.server
      ?.to(`document:${documentId}`)
      .emit('document:restored', { documentId, generation });
  }

  // ---------------------------------------------------------------------------

  private onRedisRestore(message: string): void {
    let payload: RestoreControlMessage;
    try {
      payload = JSON.parse(message) as RestoreControlMessage;
    } catch {
      this.logger.warn('Received malformed restore-control message');
      return;
    }

    if (payload.originId === this.originId) return;
    if (
      typeof payload.documentId !== 'string' ||
      typeof payload.generation !== 'number'
    ) {
      this.logger.warn('Ignored invalid restore-control message');
      return;
    }

    this.logger.info(
      { documentId: payload.documentId, generation: payload.generation },
      'Received restore-control event — evicting stale document',
    );
    void this.evictAndResync(payload.documentId, payload.generation).catch(
      (err: unknown) => {
        this.logger.error(
          { err, documentId: payload.documentId },
          'Failed to apply remote restore-control event',
        );
      },
    );
  }
}
