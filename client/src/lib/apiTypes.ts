export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiWorkspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export type ApiDocumentType = 'FILE' | 'FOLDER';

export interface ApiDocument {
  id: string;
  workspaceId: string;
  parentId: string | null;
  type: ApiDocumentType;
  path: string;
  name: string;
  language: string | null;
  content: string | null;
  /** CRDT lineage counter. Bumped by version restore; absent on older payloads. */
  crdtGeneration?: number;
  createdAt: string;
  updatedAt: string;
  children?: ApiDocument[];
}

export interface ApiAuthResponse {
  user: ApiUser;
  token: string;
}

export interface CreateWorkspacePayload {
  name: string;
  ownerId: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  displayName: string;
}

export interface UpdateProfilePayload {
  displayName?: string;
}

export interface UpdateDocumentPayload {
  content?: string | null;
  name?: string;
  path?: string;
  language?: string | null;
}

export interface CreateDocumentPayload {
  type: 'FILE' | 'FOLDER';
  name: string;
  path: string;
  parentId?: string;
  language?: string;
  content?: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  password: string;
}

// ── Members ───────────────────────────────────────────────────────────────────

export type ApiWorkspaceRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface ApiWorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: ApiWorkspaceRole;
  createdAt: string;
}

export interface UpdateWorkspacePayload {
  name?: string;
}

// ── Invites ───────────────────────────────────────────────────────────────────

export interface CreateInvitePayload {
  role: 'EDITOR' | 'VIEWER';
  email?: string;
}

export interface ApiInvite {
  id: string;
  token: string;
  workspaceId: string;
  role: ApiWorkspaceRole;
  email: string | null;
  expiresAt: string;
  inviteUrl: string;
  /** Present when an email was requested. */
  emailDelivered?: boolean;
  /** Set when the mail provider did not deliver — share this (or `inviteUrl`) manually. */
  previewInviteUrl?: string;
  /** Why delivery failed, when `emailDelivered` is false. */
  emailError?: string;
}

export interface ApiInviteDetails {
  workspaceName: string;
  role: ApiWorkspaceRole;
  invitedByName: string;
  email: string | null;
  expiresAt: string;
  expired: boolean;
  used: boolean;
}

export interface AcceptInviteResponse {
  workspaceId: string;
  workspaceName: string;
  role: ApiWorkspaceRole;
  alreadyMember: boolean;
}

// ── ZIP import ────────────────────────────────────────────────────────────────

export interface BulkCreateDocumentsPayload {
  documents: CreateDocumentPayload[];
}

// ── Document versions ───────────────────────────────────────────────────────

export interface ApiVersionAuthor {
  id: string;
  displayName: string;
}

/** Lightweight version metadata as returned by the list endpoint. */
export interface ApiDocumentVersionSummary {
  id: string;
  versionNumber: number;
  message: string | null;
  createdAt: string;
  contentLength: number;
  createdBy: ApiVersionAuthor | null;
}

/** A single version including its full content. */
export interface ApiDocumentVersionDetail {
  id: string;
  documentId: string;
  versionNumber: number;
  message: string | null;
  createdAt: string;
  content: string;
  contentLength: number;
  createdBy: ApiVersionAuthor | null;
}

export interface RestoreVersionResponse {
  document: ApiDocument;
  restoredFromVersion: number;
  newVersionNumber: number;
}
