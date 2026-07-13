import type {
  AcceptInviteResponse,
  ApiAuthResponse,
  ApiDocument,
  ApiDocumentVersionDetail,
  ApiDocumentVersionSummary,
  ApiInvite,
  ApiInviteDetails,
  ApiUser,
  ApiWorkspace,
  ApiWorkspaceMember,
  ApiWorkspaceRole,
  BulkCreateDocumentsPayload,
  CreateDocumentPayload,
  CreateInvitePayload,
  CreateWorkspacePayload,
  ForgotPasswordPayload,
  LoginPayload,
  RegisterPayload,
  ResetPasswordPayload,
  RestoreVersionResponse,
  UpdateDocumentPayload,
  UpdateProfilePayload,
  UpdateWorkspacePayload,
} from './apiTypes';

export type {
  AcceptInviteResponse,
  ApiAuthResponse,
  ApiDocument,
  ApiDocumentVersionDetail,
  ApiDocumentVersionSummary,
  ApiInvite,
  ApiInviteDetails,
  ApiUser,
  ApiWorkspace,
  ApiWorkspaceMember,
  ApiWorkspaceRole,
  BulkCreateDocumentsPayload,
  CreateDocumentPayload,
  CreateInvitePayload,
  CreateWorkspacePayload,
  ForgotPasswordPayload,
  LoginPayload,
  RegisterPayload,
  ResetPasswordPayload,
  RestoreVersionResponse,
  UpdateDocumentPayload,
  UpdateProfilePayload,
  UpdateWorkspacePayload,
};

const _rawApiUrl = import.meta.env['VITE_API_URL'] as string | undefined;
if (!_rawApiUrl && import.meta.env.DEV) {
  console.warn('[Meridian] VITE_API_URL not set — defaulting to http://localhost:3000');
}
const API_URL: string =
  _rawApiUrl ?? (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (typeof json.message === 'string' && json.message.length > 0) {
        message = json.message;
      } else if (Array.isArray(json.message) && json.message.length > 0) {
        message = (json.message as string[]).join('. ');
      }
    } catch {
      // keep default message
    }
    throw new ApiError(res.status, message);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (res.status === 204 || !contentType.includes('application/json')) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const login = (payload: LoginPayload): Promise<ApiAuthResponse> =>
  request<ApiAuthResponse>('POST', '/auth/login', payload);

export const register = (payload: RegisterPayload): Promise<ApiAuthResponse> =>
  request<ApiAuthResponse>('POST', '/auth/register', payload);

export const getCurrentUser = (): Promise<ApiUser> =>
  request<ApiUser>('GET', '/auth/me');

export const logout = (): Promise<void> => request<void>('POST', '/auth/logout');

export const updateProfile = (
  userId: string,
  payload: UpdateProfilePayload,
): Promise<ApiUser> => request<ApiUser>('PATCH', `/users/${userId}`, payload);

export const forgotPassword = (payload: ForgotPasswordPayload): Promise<{ message: string }> =>
  request<{ message: string }>('POST', '/auth/forgot-password', payload);

export const resetPassword = (payload: ResetPasswordPayload): Promise<{ message: string }> =>
  request<{ message: string }>('POST', '/auth/reset-password', payload);

// ── Workspaces ────────────────────────────────────────────────────────────────

export const getWorkspaces = (): Promise<ApiWorkspace[]> =>
  request<ApiWorkspace[]>('GET', '/workspaces');

export const getWorkspace = (workspaceId: string): Promise<ApiWorkspace> =>
  request<ApiWorkspace>('GET', `/workspaces/${workspaceId}`);

export const createWorkspace = (payload: CreateWorkspacePayload): Promise<ApiWorkspace> =>
  request<ApiWorkspace>('POST', '/workspaces', payload);

export const updateWorkspace = (
  workspaceId: string,
  payload: UpdateWorkspacePayload,
): Promise<ApiWorkspace> =>
  request<ApiWorkspace>('PATCH', `/workspaces/${workspaceId}`, payload);

export const deleteWorkspace = (workspaceId: string): Promise<void> =>
  request<void>('DELETE', `/workspaces/${workspaceId}`);

// ── Members ───────────────────────────────────────────────────────────────────

export const getWorkspaceMembers = (workspaceId: string): Promise<ApiWorkspaceMember[]> =>
  request<ApiWorkspaceMember[]>('GET', `/workspaces/${workspaceId}/members`);

export const addWorkspaceMember = (
  workspaceId: string,
  userId: string,
  role: ApiWorkspaceRole,
): Promise<ApiWorkspaceMember> =>
  request<ApiWorkspaceMember>('POST', `/workspaces/${workspaceId}/members`, { userId, role });

export const updateWorkspaceMember = (
  workspaceId: string,
  memberId: string,
  role: ApiWorkspaceRole,
): Promise<ApiWorkspaceMember> =>
  request<ApiWorkspaceMember>('PATCH', `/workspaces/${workspaceId}/members/${memberId}`, { role });

export const removeWorkspaceMember = (
  workspaceId: string,
  memberId: string,
): Promise<void> =>
  request<void>('DELETE', `/workspaces/${workspaceId}/members/${memberId}`);

// ── Invites ───────────────────────────────────────────────────────────────────

export const createInvite = (
  workspaceId: string,
  payload: CreateInvitePayload,
): Promise<ApiInvite> =>
  request<ApiInvite>('POST', `/workspaces/${workspaceId}/invites`, payload);

export const getInvite = (token: string): Promise<ApiInviteDetails> =>
  request<ApiInviteDetails>('GET', `/invites/${token}`);

export const acceptInvite = (token: string): Promise<AcceptInviteResponse> =>
  request<AcceptInviteResponse>('POST', `/invites/${token}/accept`);

// ── Documents ─────────────────────────────────────────────────────────────────

export const getWorkspaceDocuments = (workspaceId: string): Promise<ApiDocument[]> =>
  request<ApiDocument[]>('GET', `/workspaces/${workspaceId}/documents`);

export const getDocumentTree = (workspaceId: string): Promise<ApiDocument[]> =>
  request<ApiDocument[]>('GET', `/workspaces/${workspaceId}/documents/tree`);

export const getDocument = (documentId: string): Promise<ApiDocument> =>
  request<ApiDocument>('GET', `/documents/${documentId}`);

export const createDocument = (
  workspaceId: string,
  payload: CreateDocumentPayload,
): Promise<ApiDocument> =>
  request<ApiDocument>('POST', `/workspaces/${workspaceId}/documents`, payload);

export const updateDocument = (
  documentId: string,
  payload: UpdateDocumentPayload,
): Promise<ApiDocument> =>
  request<ApiDocument>('PATCH', `/documents/${documentId}`, payload);

export const deleteDocument = (documentId: string): Promise<void> =>
  request<void>('DELETE', `/documents/${documentId}`);

export const bulkCreateDocuments = (
  workspaceId: string,
  payload: BulkCreateDocumentsPayload,
): Promise<ApiDocument[]> =>
  request<ApiDocument[]>('POST', `/workspaces/${workspaceId}/documents/bulk`, payload);

// ── Document versions ─────────────────────────────────────────────────────────

export const getDocumentVersions = (
  documentId: string,
): Promise<ApiDocumentVersionSummary[]> =>
  request<ApiDocumentVersionSummary[]>('GET', `/documents/${documentId}/versions`);

export const getDocumentVersion = (
  documentId: string,
  versionId: string,
): Promise<ApiDocumentVersionDetail> =>
  request<ApiDocumentVersionDetail>(
    'GET',
    `/documents/${documentId}/versions/${versionId}`,
  );

export const restoreDocumentVersion = (
  documentId: string,
  versionId: string,
): Promise<RestoreVersionResponse> =>
  request<RestoreVersionResponse>(
    'POST',
    `/documents/${documentId}/versions/${versionId}/restore`,
  );

// ── Workspace export ────────────────────────────────────────────────────────

/** Parses a filename out of a Content-Disposition header, if present. */
function filenameFromDisposition(header: string | null): string | null {
  if (header === null) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Downloads a workspace as a ZIP. Returns the raw blob plus the server-provided
 * filename (from Content-Disposition) so the caller can trigger the download.
 */
export const exportWorkspaceZip = async (
  workspaceId: string,
): Promise<{ blob: Blob; filename: string }> => {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/export`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Export failed: HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const filename =
    filenameFromDisposition(res.headers.get('content-disposition')) ?? 'workspace.zip';
  return { blob, filename };
};
