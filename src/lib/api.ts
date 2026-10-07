import type {
  AppData,
  ContactRecord,
  Relationship,
} from '../types/models';

export type NodePosition = {
  recordId: string;
  x: number;
  y: number;
};

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();

    throw new Error(
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