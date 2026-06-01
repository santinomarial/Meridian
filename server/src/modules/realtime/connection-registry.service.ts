import { Injectable } from '@nestjs/common';
import type { ConnectionEntry, DocumentId, SocketId, UserId } from './realtime.types';

@Injectable()
export class ConnectionRegistryService {
  private readonly sockets = new Map<SocketId, ConnectionEntry>();
  private readonly documents = new Map<DocumentId, Set<SocketId>>();

  register(socketId: SocketId, userId?: UserId): void {
    this.sockets.set(socketId, {
      socketId,
      userId,
      documentIds: new Set(),
      connectedAt: new Date(),
    });
  }

  join(socketId: SocketId, documentId: DocumentId): void {
    const entry = this.sockets.get(socketId);
    if (entry === undefined) return;

    entry.documentIds.add(documentId);

    const room = this.documents.get(documentId) ?? new Set<SocketId>();
    room.add(socketId);
    this.documents.set(documentId, room);
  }

  leave(socketId: SocketId, documentId: DocumentId): void {
    const entry = this.sockets.get(socketId);
    if (entry !== undefined) {
      entry.documentIds.delete(documentId);
    }

    const room = this.documents.get(documentId);
    if (room !== undefined) {
      room.delete(socketId);
      if (room.size === 0) {
        this.documents.delete(documentId);
      }
    }
  }

  disconnect(socketId: SocketId): void {
    const entry = this.sockets.get(socketId);
    if (entry === undefined) return;

    for (const documentId of entry.documentIds) {
      const room = this.documents.get(documentId);
      if (room !== undefined) {
        room.delete(socketId);
        if (room.size === 0) {
          this.documents.delete(documentId);
        }
      }
    }

    this.sockets.delete(socketId);
  }

  getSocketsInDocument(documentId: DocumentId): SocketId[] {
    return [...(this.documents.get(documentId) ?? [])];
  }

  getDocumentsForSocket(socketId: SocketId): DocumentId[] {
    const entry = this.sockets.get(socketId);
    return entry !== undefined ? [...entry.documentIds] : [];
  }

  size(): number {
    return this.sockets.size;
  }
}
