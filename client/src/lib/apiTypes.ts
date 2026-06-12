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
