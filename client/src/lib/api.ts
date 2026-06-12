import type {
  ApiAuthResponse,
  ApiDocument,
  ApiUser,
  ApiWorkspace,
  CreateDocumentPayload,
  CreateWorkspacePayload,
  ForgotPasswordPayload,
  LoginPayload,
  RegisterPayload,
  ResetPasswordPayload,
  UpdateDocumentPayload,
} from './apiTypes';

export type {
  ApiAuthResponse,
  ApiDocument,
  ApiUser,
  ApiWorkspace,
  CreateDocumentPayload,
  CreateWorkspacePayload,
  ForgotPasswordPayload,
  LoginPayload,
  RegisterPayload,
  ResetPasswordPayload,
  UpdateDocumentPayload,
};

const _rawApiUrl = import.meta.env['VITE_API_URL'] as string | undefined;
if (!_rawApiUrl && import.meta.env.DEV) {
  console.warn('[Meridian] VITE_API_URL not set — defaulting to http://localhost:3000');
}
const API_URL: string = _rawApiUrl ?? 'http://localhost:3000';

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
