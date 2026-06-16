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
}

export interface ApiInviteDetails {
  token: string;
  workspaceName: string;
  role: ApiWorkspaceRole;
  invitedByName: string;
  expiresAt: string;
  expired: boolean;
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
