export type SocketId = string;
export type UserId = string;
export type DocumentId = string;

export interface ConnectionEntry {
  socketId: SocketId;
  userId: UserId | undefined;
  documentIds: Set<DocumentId>;
  connectedAt: Date;
}
