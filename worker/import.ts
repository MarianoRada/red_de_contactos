import {
  relationshipTypes,
  type RecordType,
  type RelationshipType,
} from '../src/types/models';
import { MAX_NODES } from '../src/lib/nodeLimits';

export interface ImportEnv {
  DB: D1Database;
  IMPORT_ENABLED?: string;
}

type ImportIssue = {
  code: string;
  message: string;
  row?: number;
  column?: string;
};

type ImportRecordInput = {
  record_key?: unknown;
  id?: unknown;
  name: unknown;
  description?: unknown;
  email?: unknown;
  location?: unknown;
  type: unknown;
};

type ImportRelationshipInput = {
  relationship_key?: unknown;
  source?: unknown;
  target?: unknown;
  source_ref?: unknown;
  target_ref?: unknown;
  type: unknown;
};

type PreparedRecord = {
  record_key: string;
  id: string;
  name: string;
  description: string;
  email: string | null;
  location: string | null;
  type: RecordType;
};

type PreparedRelationship = {
  relationship_key: string;
  source_id: string;
  target_id: string;
  type: RelationshipType;
};

type PendingExistingReference = {
  id: string;
  row: number;
  column: 'source_ref' | 'target_ref';
};

type ExistingRecordReference = {
  id: string;
  name: string;
};

type ImportPayload = {
  importId: string;
  records: ImportRecordInput[];
  relationships: ImportRelationshipInput[];
};

type ExistingImport = {
  import_id: string;
  payload_hash: string;
  records_count: number;
  relationships_count: number;
};

const MAX_IMPORT_BODY_BYTES = 1_800_000;
const MAX_RECORDS = MAX_NODES;
const MAX_RELATIONSHIPS = 1_500;
const MAX_ISSUES = 500;

const MAX_LENGTHS = {
  importId: 128,
  recordKey: 200,
  recordId: 200,
  name: 300,
  description: 5_000,
  email: 320,
  location: 500,
  relationshipKey: 200,
  reference: 200,
  relationshipType: 100,
} as const;

const RECORD_TYPES = new Set<RecordType>([
  'person',
  'company',
  'institution',
]);

const RELATIONSHIP_TYPES = new Set<string>(relationshipTypes);

const json = (data: unknown, status = 200) =>
  Response.json(data, { status });

function validationResponse(
  issues: ImportIssue[],
  status = 422
) {
  return json(
    {
      error: 'import_validation_failed',
      message: 'La importación contiene errores de validación.',
      issues: issues.slice(0, MAX_ISSUES),
      issuesTruncated: issues.length > MAX_ISSUES,
    },
    status
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: ImportIssue[],
  code: string,
  message: string,
  row?: number,
  column?: string
) {
  issues.push({ code, message, ...(row ? { row } : {}), ...(column ? { column } : {}) });
}

function readText(
  value: unknown,
  options: {
    field: string;
    row: number;
    issues: ImportIssue[];
    required?: boolean;
    maxLength: number;
    nullable?: boolean;
  }
): string {
  const {
    field,
    row,
    issues,
    required = false,
    maxLength,
    nullable = false,
  } = options;

  if (value === undefined || value === null) {
    if (required) {
      addIssue(issues, 'required_field', `El campo "${field}" es obligatorio.`, row, field);
    }

    return '';
  }

  if (typeof value !== 'string') {
    addIssue(issues, 'invalid_type', `El campo "${field}" debe ser texto.`, row, field);
    return '';
  }

  const normalized = value.replace(/^\uFEFF/, '').trim();

  if (normalized.length > maxLength) {
    addIssue(
      issues,
      'field_too_long',
      `El campo "${field}" supera el máximo de ${maxLength} caracteres.`,
      row,
      field
    );
  }

  if (required && normalized.length === 0) {
    addIssue(issues, 'required_field', `El campo "${field}" es obligatorio.`, row, field);
  }

  if (!nullable && normalized.length === 0 && value !== '') {
    addIssue(issues, 'invalid_value', `El campo "${field}" no puede quedar vacío.`, row, field);
  }

  return normalized;
}

function checkAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  issues: ImportIssue[],
  row?: number
) {
  const allowedSet = new Set(allowed);

  Object.keys(value).forEach((key) => {
    if (!allowedSet.has(key)) {
      addIssue(
        issues,
        'unknown_field',
        `El campo "${key}" no está permitido en esta importación.`,
        row,
        key
      );
    }
  });
}

function validateEmail(email: string, issues: ImportIssue[], row: number) {
  if (!email) {
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    addIssue(issues, 'invalid_email', 'El email no tiene un formato válido.', row, 'email');
  }
}

function isImportEnabled(request: Request, env: ImportEnv) {
  void request;
  return env.IMPORT_ENABLED !== 'false';
}

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique|primary key|foreign key/i.test(message);
}

function isNodeLimitError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /MAX_NODES_EXCEEDED/i.test(message);
}

async function countRecords(db: D1Database) {
  const result = await db
    .prepare('SELECT COUNT(*) AS count FROM records')
    .first<{ count: number }>();

  return Number(result?.count ?? 0);
}

function nodeLimitResponse(existingNodes: number, requestedNodes: number) {
  const availableNodes = Math.max(MAX_NODES - existingNodes, 0);

  return json(
    {
      error: 'node_limit_exceeded',
      message: `La importaciÃ³n supera el lÃ­mite de ${MAX_NODES.toLocaleString('es-AR')} nodos.`,
      details: {
        maxNodes: MAX_NODES,
        existingNodes,
        requestedNodes,
        availableNodes,
      },
    },
    409
  );
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function serializedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase('es-AR');
}

function normalizePayload(
  value: unknown,
  issues: ImportIssue[]
): ImportPayload | undefined {
  if (!isPlainObject(value)) {
    addIssue(issues, 'invalid_payload', 'El cuerpo debe ser un objeto JSON.');
    return undefined;
  }

  checkAllowedKeys(value, ['importId', 'records', 'relationships'], issues);

  const importId = readText(value.importId, {
    field: 'importId',
    row: 0,
    issues,
    required: true,
    maxLength: MAX_LENGTHS.importId,
  });

  if (!Array.isArray(value.records)) {
    addIssue(issues, 'invalid_type', 'records debe ser un arreglo.');
  }

  if (!Array.isArray(value.relationships)) {
    addIssue(issues, 'invalid_type', 'relationships debe ser un arreglo.');
  }

  const records = Array.isArray(value.records) ? value.records : [];
  const relationships = Array.isArray(value.relationships) ? value.relationships : [];

  if (records.length === 0 && relationships.length === 0) {
    addIssue(issues, 'empty_import', 'La importación debe contener registros o relaciones.');
  }

  if (records.length > MAX_RECORDS) {
    addIssue(issues, 'too_many_records', `La importación admite como máximo ${MAX_RECORDS} registros.`);
  }

  if (relationships.length > MAX_RELATIONSHIPS) {
    addIssue(
      issues,
      'too_many_relationships',
      `La importación admite como máximo ${MAX_RELATIONSHIPS} relaciones.`
    );
  }

  return {
    importId,
    records: records as ImportRecordInput[],
    relationships: relationships as ImportRelationshipInput[],
  };
}

function prepareRecords(
  records: ImportRecordInput[],
  issues: ImportIssue[]
) {
  const recordKeys = new Map<string, number>();
  const recordIds = new Map<string, number>();
  const prepared: Array<{
    record_key: string;
    requestedId: string;
    name: string;
    description: string;
    email: string | null;
    location: string | null;
    type: RecordType;
  }> = [];

  records.forEach((value, index) => {
    const row = index + 2;

    if (!isPlainObject(value)) {
      addIssue(issues, 'invalid_row', 'Cada registro debe ser un objeto JSON.', row);
      return;
    }

    checkAllowedKeys(
      value,
      ['record_key', 'id', 'name', 'description', 'email', 'location', 'type'],
      issues,
      row
    );

    const recordKey = readText(value.record_key, {
      field: 'record_key',
      row,
      issues,
      maxLength: MAX_LENGTHS.recordKey,
    });
    const requestedId = readText(value.id, {
      field: 'id',
      row,
      issues,
      maxLength: MAX_LENGTHS.recordId,
      nullable: true,
    });
    const name = readText(value.name, {
      field: 'name',
      row,
      issues,
      required: true,
      maxLength: MAX_LENGTHS.name,
    });
    const description = readText(value.description, {
      field: 'description',
      row,
      issues,
      maxLength: MAX_LENGTHS.description,
      nullable: true,
    });
    const email = readText(value.email, {
      field: 'email',
      row,
      issues,
      maxLength: MAX_LENGTHS.email,
      nullable: true,
    });
    const location = readText(value.location, {
      field: 'location',
      row,
      issues,
      maxLength: MAX_LENGTHS.location,
      nullable: true,
    });
    const rawType = readText(value.type, {
      field: 'type',
      row,
      issues,
      required: true,
      maxLength: MAX_LENGTHS.relationshipType,
    });

    const resolvedRecordKey = recordKey || `__import_record_${row}`;

    if (resolvedRecordKey) {
      const previous = recordKeys.get(resolvedRecordKey);
      if (previous) {
        addIssue(issues, 'duplicate_record_key', `record_key repetido; también aparece en la fila ${previous}.`, row, 'record_key');
      } else {
        recordKeys.set(resolvedRecordKey, row);
      }
    }

    if (requestedId) {
      const previous = recordIds.get(requestedId);
      if (previous) {
        addIssue(issues, 'duplicate_id', `ID repetido; también aparece en la fila ${previous}.`, row, 'id');
      } else {
        recordIds.set(requestedId, row);
      }
    }

    validateEmail(email, issues, row);

    if (!RECORD_TYPES.has(rawType as RecordType)) {
      addIssue(issues, 'invalid_record_type', `Tipo de registro inválido: "${rawType}".`, row, 'type');
    }

    prepared.push({
      record_key: resolvedRecordKey,
      requestedId,
      name,
      description,
      email: email || null,
      location: location || null,
      type: rawType as RecordType,
    });
  });

  return { prepared, recordKeys };
}

function prepareRelationships(
  relationships: ImportRelationshipInput[],
  recordKeyToId: Map<string, string>,
  issues: ImportIssue[]
) {
  const relationshipKeys = new Map<string, number>();
  const relationshipSignatures = new Map<string, number>();
  const pendingExistingIds = new Set<string>();
  const pendingExistingReferences: PendingExistingReference[] = [];
  const prepared: PreparedRelationship[] = [];

  relationships.forEach((value, index) => {
    const row = index + 2;

    if (!isPlainObject(value)) {
      addIssue(issues, 'invalid_row', 'Cada relación debe ser un objeto JSON.', row);
      return;
    }

    checkAllowedKeys(
      value,
      ['relationship_key', 'source_ref', 'target_ref', 'type'],
      issues,
      row
    );

    const relationshipKey = readText(value.relationship_key, {
      field: 'relationship_key',
      row,
      issues,
      required: true,
      maxLength: MAX_LENGTHS.relationshipKey,
    });
    const sourceRef = readText(value.source_ref, {
      field: 'source_ref',
      row,
      issues,
      required: true,
      maxLength: MAX_LENGTHS.reference,
    });
    const targetRef = readText(value.target_ref, {
      field: 'target_ref',
      row,
      issues,
      required: true,
      maxLength: MAX_LENGTHS.reference,
    });
    const type = readText(value.type, {
      field: 'type',
      row,
      issues,
      required: true,
      maxLength: MAX_LENGTHS.relationshipType,
    });

    if (relationshipKey) {
      const previous = relationshipKeys.get(relationshipKey);
      if (previous) {
        addIssue(issues, 'duplicate_relationship_key', `relationship_key repetido; también aparece en la fila ${previous}.`, row, 'relationship_key');
      } else {
        relationshipKeys.set(relationshipKey, row);
      }
    }

    if (!RELATIONSHIP_TYPES.has(type)) {
      addIssue(issues, 'invalid_relationship_type', `Tipo de relación inválido: "${type}".`, row, 'type');
    }

    const resolveReference = (reference: string, column: string) => {
      if (reference.startsWith('id:')) {
        const existingId = reference.slice(3).trim();
        if (!existingId) {
          addIssue(issues, 'invalid_reference', 'La referencia id: debe contener un identificador.', row, column);
          return '';
        }

        pendingExistingIds.add(existingId);
        pendingExistingReferences.push({
          id: existingId,
          row,
          column: column as 'source_ref' | 'target_ref',
        });
        return existingId;
      }

      const resolved = recordKeyToId.get(reference);
      if (!resolved) {
        addIssue(issues, 'missing_reference', `La referencia "${reference}" no existe en los registros de esta importación.`, row, column);
      }

      return resolved ?? '';
    };

    const sourceId = resolveReference(sourceRef, 'source_ref');
    const targetId = resolveReference(targetRef, 'target_ref');

    if (sourceId && targetId && sourceId === targetId) {
      addIssue(issues, 'self_relationship', 'Una relación no puede apuntar al mismo registro en ambos extremos.', row);
    }

    if (sourceId && targetId && RELATIONSHIP_TYPES.has(type)) {
      const signature = `${sourceId}\u0000${targetId}\u0000${type}`;
      const previous = relationshipSignatures.get(signature);
      if (previous) {
        addIssue(issues, 'duplicate_relationship', `La relación ya aparece en la fila ${previous}.`, row);
      } else {
        relationshipSignatures.set(signature, row);
      }
    }

    prepared.push({
      relationship_key: relationshipKey,
      source_id: sourceId,
      target_id: targetId,
      type: type as RelationshipType,
    });
  });

  return { prepared, pendingExistingIds, pendingExistingReferences };
}

async function existingRecordReferences(db: D1Database) {
  const { results } = await db
    .prepare('SELECT id, name FROM records')
    .all<ExistingRecordReference>();

  return results;
}

function prepareRelationshipsByName(
  relationships: ImportRelationshipInput[],
  recordKeyToId: Map<string, string>,
  recordKeyToName: Map<string, string>,
  existingRecords: ExistingRecordReference[],
  issues: ImportIssue[]
) {
  const relationshipKeys = new Map<string, number>();
  const relationshipSignatures = new Map<string, number>();
  const prepared: PreparedRelationship[] = [];

  const existingById = new Map(existingRecords.map((record) => [record.id, record]));
  const candidatesByName = new Map<string, Array<{ ref: string; id: string; name: string }>>();

  const addCandidate = (candidate: { ref: string; id: string; name: string }) => {
    const key = normalizedName(candidate.name);
    const candidates = candidatesByName.get(key) ?? [];
    candidates.push(candidate);
    candidatesByName.set(key, candidates);
  };

  recordKeyToId.forEach((id, recordKey) => {
    addCandidate({ ref: recordKey, id, name: recordKeyToName.get(recordKey) ?? '' });
  });
  existingRecords.forEach((record) => {
    addCandidate({ ref: `id:${record.id}`, id: record.id, name: record.name });
  });

  relationships.forEach((value, index) => {
    const row = index + 2;

    if (!isPlainObject(value)) {
      addIssue(issues, 'invalid_row', 'Cada relación debe ser un objeto JSON.', row);
      return;
    }

    const isLegacy = value.source === undefined && value.target === undefined;
    checkAllowedKeys(
      value,
      isLegacy
        ? ['relationship_key', 'source_ref', 'target_ref', 'type']
        : ['relationship_key', 'source', 'target', 'source_ref', 'target_ref', 'type'],
      issues,
      row
    );

    const relationshipKey = readText(value.relationship_key, {
      field: 'relationship_key',
      row,
      issues,
      required: isLegacy,
      maxLength: MAX_LENGTHS.relationshipKey,
      nullable: true,
    });
    const sourceName = readText(isLegacy ? value.source_ref : value.source, {
      field: isLegacy ? 'source_ref' : 'source',
      row,
      issues,
      required: true,
      maxLength: isLegacy ? MAX_LENGTHS.reference : MAX_LENGTHS.name,
    });
    const targetName = readText(isLegacy ? value.target_ref : value.target, {
      field: isLegacy ? 'target_ref' : 'target',
      row,
      issues,
      required: true,
      maxLength: isLegacy ? MAX_LENGTHS.reference : MAX_LENGTHS.name,
    });
    const selectedSource = readText(value.source_ref, {
      field: 'source_ref',
      row,
      issues,
      maxLength: MAX_LENGTHS.reference,
      nullable: true,
    });
    const selectedTarget = readText(value.target_ref, {
      field: 'target_ref',
      row,
      issues,
      maxLength: MAX_LENGTHS.reference,
      nullable: true,
    });
    const type = readText(value.type, {
      field: 'type',
      row,
      issues,
      required: true,
      maxLength: MAX_LENGTHS.relationshipType,
    });

    const resolveReference = (name: string, selectedRef: string, column: string) => {
      if (isLegacy) {
        if (selectedRef.startsWith('id:')) {
          const existing = existingById.get(selectedRef.slice(3));
          if (!existing) {
            addIssue(issues, 'missing_reference', `El registro existente "${selectedRef.slice(3)}" no fue encontrado en D1.`, row, column);
            return '';
          }
          return existing.id;
        }

        const id = recordKeyToId.get(selectedRef);
        if (!id) {
          addIssue(issues, 'missing_reference', `La referencia "${selectedRef}" no existe en los registros de esta importación.`, row, column);
        }
        return id ?? '';
      }

      const candidates = candidatesByName.get(normalizedName(name)) ?? [];
      const selected = selectedRef
        ? candidates.find((candidate) => candidate.ref === selectedRef)
        : undefined;

      if (selectedRef && !selected) {
        addIssue(issues, 'reference_name_mismatch', `La selección de "${name}" no corresponde a un contacto con ese nombre.`, row, column);
        return '';
      }

      if (selected) {
        return selected.id;
      }

      if (candidates.length === 0) {
        addIssue(issues, 'missing_reference', `No existe un contacto llamado "${name}".`, row, column);
        return '';
      }

      if (candidates.length > 1) {
        addIssue(issues, 'ambiguous_reference', `El nombre "${name}" coincide con varios contactos; seleccioná uno explícitamente.`, row, column);
        return '';
      }

      return candidates[0].id;
    };

    const sourceId = resolveReference(sourceName, selectedSource, 'source_ref');
    const targetId = resolveReference(targetName, selectedTarget, 'target_ref');

    if (sourceId && targetId && sourceId === targetId) {
      addIssue(issues, 'self_relationship', 'Una relación no puede apuntar al mismo registro en ambos extremos.', row);
    }

    const relationshipId = relationshipKey || crypto.randomUUID();
    const previousKey = relationshipKeys.get(relationshipId);
    if (previousKey) {
      addIssue(issues, 'duplicate_relationship_key', `La relación se repite; también aparece en la fila ${previousKey}.`, row, 'relationship_key');
    } else {
      relationshipKeys.set(relationshipId, row);
    }

    if (sourceId && targetId && RELATIONSHIP_TYPES.has(type)) {
      const signature = `${sourceId}\u0000${targetId}\u0000${type}`;
      const previous = relationshipSignatures.get(signature);
      if (previous) {
        addIssue(issues, 'duplicate_relationship', `La relación ya aparece en la fila ${previous}.`, row);
      } else {
        relationshipSignatures.set(signature, row);
      }
    }

    prepared.push({
      relationship_key: relationshipId,
      source_id: sourceId,
      target_id: targetId,
      type: type as RelationshipType,
    });
  });

  return { prepared };
}

async function existingIds(
  db: D1Database,
  table: 'records' | 'relationships',
  ids: string[]
) {
  if (ids.length === 0) {
    return [];
  }

  const { results } = await db
    .prepare(`
      SELECT id
      FROM ${table}
      WHERE id IN (SELECT value FROM json_each(?))
    `)
    .bind(JSON.stringify(ids))
    .all<{ id: string }>();

  return results.map((result) => result.id);
}

async function existingRelationshipSignatures(
  db: D1Database,
  relationships: PreparedRelationship[]
) {
  if (relationships.length === 0) {
    return [];
  }

  const { results } = await db
    .prepare(`
      SELECT
        source_id AS sourceId,
        target_id AS targetId,
        type
      FROM relationships
      WHERE EXISTS (
        SELECT 1
        FROM json_each(?) AS incoming
        WHERE source_id = json_extract(incoming.value, '$.source_id')
          AND target_id = json_extract(incoming.value, '$.target_id')
          AND type = json_extract(incoming.value, '$.type')
      )
    `)
    .bind(JSON.stringify(relationships))
    .all<{ sourceId: string; targetId: string; type: string }>();

  return results.map(
    (result) => `${result.sourceId}\u0000${result.targetId}\u0000${result.type}`
  );
}

async function handleImport(request: Request, env: ImportEnv) {
  if (!isImportEnabled(request, env)) {
    return json(
      {
        error: 'import_disabled',
        message: 'La importación está deshabilitada fuera del entorno local autorizado.',
      },
      403
    );
  }

  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json(
      { error: 'invalid_content_type', message: 'El endpoint requiere Content-Type application/json.' },
      400
    );
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BODY_BYTES) {
    return json(
      { error: 'payload_too_large', message: `El payload supera el máximo de ${MAX_IMPORT_BODY_BYTES} bytes.` },
      413
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: 'invalid_body', message: 'No se pudo leer el cuerpo de la petición.' }, 400);
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_IMPORT_BODY_BYTES) {
    return json(
      { error: 'payload_too_large', message: `El payload supera el máximo de ${MAX_IMPORT_BODY_BYTES} bytes.` },
      413
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody) as unknown;
  } catch {
    return json({ error: 'invalid_json', message: 'El cuerpo no contiene JSON válido.' }, 400);
  }

  const issues: ImportIssue[] = [];
  const payload = normalizePayload(decoded, issues);

  if (!payload || issues.length > 0) {
    return validationResponse(issues.length > 0 ? issues : [{ code: 'invalid_payload', message: 'Payload inválido.' }]);
  }

  const recordPreparation = prepareRecords(payload.records, issues);

  if (issues.length > 0) {
    return validationResponse(issues);
  }

  const normalizedInput = {
    records: recordPreparation.prepared,
    relationships: payload.relationships,
  };
  const payloadHash = await sha256(JSON.stringify(normalizedInput));

  const previousImport = await env.DB
    .prepare(`
      SELECT
        import_id,
        payload_hash,
        records_count,
        relationships_count
      FROM import_operations
      WHERE import_id = ?
    `)
    .bind(payload.importId)
    .first<ExistingImport>();

  if (previousImport) {
    if (previousImport.payload_hash !== payloadHash) {
      return json(
        {
          error: 'import_id_conflict',
          message: 'importId ya fue utilizado con un payload diferente.',
        },
        409
      );
    }

    return json({
      success: true,
      idempotent: true,
      importId: payload.importId,
      inserted: {
        records: previousImport.records_count,
        relationships: previousImport.relationships_count,
      },
    });
  }

  const existingNodes = await countRecords(env.DB);
  if (existingNodes + recordPreparation.prepared.length > MAX_NODES) {
    return nodeLimitResponse(existingNodes, recordPreparation.prepared.length);
  }

  const generatedIds = new Set<string>();
  const recordKeyToId = new Map<string, string>();
  const recordKeyToName = new Map<string, string>();
  const preparedRecords: PreparedRecord[] = recordPreparation.prepared.map((record) => {
    let id = record.requestedId;

    if (!id) {
      do {
        id = crypto.randomUUID();
      } while (generatedIds.has(id));
    }

    generatedIds.add(id);
    recordKeyToId.set(record.record_key, id);
    recordKeyToName.set(record.record_key, record.name);

    return {
      record_key: record.record_key,
      id,
      name: record.name,
      description: record.description,
      email: record.email,
      location: record.location,
      type: record.type,
    };
  });

  const existingRecords = await existingRecordReferences(env.DB);
  const relationshipPreparation = prepareRelationshipsByName(
    payload.relationships,
    recordKeyToId,
    recordKeyToName,
    existingRecords,
    issues
  );

  if (issues.length > 0) {
    return validationResponse(issues);
  }

  const recordIds = preparedRecords.map((record) => record.id);
  const relationshipIds = relationshipPreparation.prepared.map(
    (relationship) => relationship.relationship_key
  );
  const existingRecordIds = await existingIds(env.DB, 'records', recordIds);
  const existingRelationshipIds = await existingIds(
    env.DB,
    'relationships',
    relationshipIds
  );
  existingRecordIds.forEach((id) => {
    const row = preparedRecords.findIndex((record) => record.id === id) + 2;
    addIssue(issues, 'record_conflict', `El registro con ID "${id}" ya existe en D1.`, row, 'id');
  });

  existingRelationshipIds.forEach((id) => {
    const row = relationshipIds.indexOf(id) + 2;
    addIssue(issues, 'relationship_conflict', `La relación con ID "${id}" ya existe en D1.`, row, 'relationship_key');
  });

  const existingSignatures = await existingRelationshipSignatures(
    env.DB,
    relationshipPreparation.prepared
  );
  const existingSignatureSet = new Set(existingSignatures);

  relationshipPreparation.prepared.forEach((relationship, index) => {
    const signature = `${relationship.source_id}\u0000${relationship.target_id}\u0000${relationship.type}`;
    if (existingSignatureSet.has(signature)) {
      addIssue(
        issues,
        'relationship_conflict',
        'La relación ya existe en D1 con el mismo origen, destino y tipo.',
        index + 2
      );
    }
  });

  if (issues.length > 0) {
    return validationResponse(issues, 409);
  }

  const recordsJson = JSON.stringify(preparedRecords);
  const relationshipsJson = JSON.stringify(relationshipPreparation.prepared);

  if (
    serializedBytes(recordsJson) > MAX_IMPORT_BODY_BYTES ||
    serializedBytes(relationshipsJson) > MAX_IMPORT_BODY_BYTES
  ) {
    return json(
      {
        error: 'payload_too_large',
        message: 'El contenido de registros o relaciones supera el tamaño máximo admitido por una operación atómica.',
      },
      413
    );
  }

  try {
    await env.DB.batch([
      env.DB
        .prepare(`
          INSERT INTO import_operations (
            import_id,
            payload_hash,
            records_count,
            relationships_count
          )
          VALUES (?, ?, ?, ?)
        `)
        .bind(
          payload.importId,
          payloadHash,
          preparedRecords.length,
          relationshipPreparation.prepared.length
        ),
      env.DB
        .prepare(`
          INSERT INTO records (
            id,
            name,
            description,
            email,
            location,
            type
          )
          SELECT
            json_extract(value, '$.id'),
            json_extract(value, '$.name'),
            COALESCE(json_extract(value, '$.description'), ''),
            NULLIF(json_extract(value, '$.email'), ''),
            NULLIF(json_extract(value, '$.location'), ''),
            json_extract(value, '$.type')
          FROM json_each(?)
        `)
        .bind(recordsJson),
      env.DB
        .prepare(`
          INSERT INTO relationships (
            id,
            source_id,
            target_id,
            type
          )
          SELECT
            json_extract(value, '$.relationship_key'),
            json_extract(value, '$.source_id'),
            json_extract(value, '$.target_id'),
            json_extract(value, '$.type')
          FROM json_each(?)
        `)
        .bind(relationshipsJson),
    ]);
  } catch (error) {
    if (isNodeLimitError(error)) {
      return nodeLimitResponse(existingNodes, preparedRecords.length);
    }

    if (isConstraintError(error)) {
      return json(
        {
          error: 'import_conflict',
          message: 'La importación entró en conflicto con datos creados simultáneamente. No se aplicaron cambios parciales.',
        },
        409
      );
    }

    throw error;
  }

  return json(
    {
      success: true,
      idempotent: false,
      importId: payload.importId,
      inserted: {
        records: preparedRecords.length,
        relationships: relationshipPreparation.prepared.length,
      },
    },
    201
  );
}

export async function handleBulkImport(request: Request, env: ImportEnv) {
  try {
    return await handleImport(request, env);
  } catch (error) {
    console.error('Bulk import failed', error);
    return json(
      {
        error: 'internal_error',
        message: 'No se pudo completar la importación.',
      },
      500
    );
  }
}
