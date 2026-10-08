import type {
  AppData,
  ContactRecord,
  Relationship,
} from '../types/models';
import type {
  BulkImportPayload,
  BulkImportResult,
} from './bulkImportTypes';
import type { AuthSession, AuthUser } from './authTypes';

export type NodePosition = {
  recordId: string;
  x: number;
  y: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let csrfToken: string | undefined;
let authFailureHandler: (() => void) | undefined;

export function setAuthFailureHandler(handler?: () => void) {
  authFailureHandler = handler;
}

export function setCsrfToken(token: string) {
  csrfToken = token;
}

function isUnsafeRequest(options?: RequestInit) {
  const method = (options?.method ?? 'GET').toUpperCase();
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(isUnsafeRequest(options) && csrfToken
        ? { 'X-CSRF-Token': csrfToken }
        : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const rawBody = await response.text();
    let body: unknown = rawBody;

    try {
      body = rawBody ? JSON.parse(rawBody) : undefined;
    } catch {
      // Keep the raw response for non-JSON errors.
    }

    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : rawBody;

    const errorCode =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : undefined;

    if (
      response.status === 401 &&
      (errorCode === 'authentication_required' || errorCode === 'session_expired')
    ) {
      authFailureHandler?.();
    }

    throw new ApiError(
      response.status,
      body,
      message || `Error HTTP ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

// ==========================================
// CARGA INICIAL
// ==========================================

export async function loadData(): Promise<AppData> {
  const [records, relationships] = await Promise.all([
    request<ContactRecord[]>('/api/records'),
    request<Relationship[]>('/api/relationships'),
  ]);

  return {
    records,
    relationships,
  };
}

// ==========================================
// RECORDS
// ==========================================

export function createRecord(
  record: ContactRecord
): Promise<ContactRecord> {
  return request<ContactRecord>('/api/records', {
    method: 'POST',
    body: JSON.stringify(record),
  });
}

export function updateRecord(
  record: ContactRecord
): Promise<ContactRecord> {
  return request<ContactRecord>(
    `/api/records/${encodeURIComponent(record.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(record),
    }
  );
}

export function deleteRecord(
  id: string
): Promise<{ success: boolean; id: string }> {
  return request(
    `/api/records/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    }
  );
}

// ==========================================
// RELATIONSHIPS
// ==========================================

export function createRelationship(
  relationship: Relationship
): Promise<Relationship> {
  return request<Relationship>(
    '/api/relationships',
    {
      method: 'POST',
      body: JSON.stringify(relationship),
    }
  );
}

export function updateRelationship(
  relationship: Relationship
): Promise<Relationship> {
  return request<Relationship>(
    `/api/relationships/${encodeURIComponent(
      relationship.id
    )}`,
    {
      method: 'PUT',
      body: JSON.stringify(relationship),
    }
  );
}

export function deleteRelationship(
  id: string
): Promise<{ success: boolean; id: string }> {
  return request(
    `/api/relationships/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
    }
  );
}

// ==========================================
// NODE POSITIONS
// ==========================================

export function loadNodePositions(): Promise<NodePosition[]> {
  return request<NodePosition[]>('/api/node-positions');
}

export function saveNodePosition(
  recordId: string,
  x: number,
  y: number
): Promise<NodePosition> {
  return request<NodePosition>(
    `/api/node-positions/${encodeURIComponent(recordId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        x,
        y,
      }),
    }
  );
}

export async function getAuthSession(): Promise<AuthSession> {
  const session = await request<AuthSession>('/api/auth/session');
  setCsrfToken(session.csrfToken);
  return session;
}

export async function loginAdmin(
  email: string,
  password: string
): Promise<{ user: AuthUser; csrfToken: string }> {
  const result = await request<{ user: AuthUser; csrfToken: string }>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }
  );

  setCsrfToken(result.csrfToken);
  return result;
}

export async function logoutAdmin(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST', body: '{}' });
  csrfToken = undefined;
}

export function importBulkData(
  payload: BulkImportPayload
): Promise<BulkImportResult> {
  return request<BulkImportResult>('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
