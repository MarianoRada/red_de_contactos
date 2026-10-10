import {
  relationshipTypes,
  type RecordType,
  type RelationshipType,
} from '../types/models';
import type {
  BulkImportFileKind,
  BulkImportValidation,
  CsvRow,
  CsvValues,
  ImportIssue,
  ImportPreviewRow,
  ParsedCsvFile,
} from './bulkImportTypes';

export const CONTACT_HEADERS = ['name', 'type', 'description', 'email', 'location'] as const;
export const RELATIONSHIP_HEADERS = ['source', 'target', 'type'] as const;
export const LEGACY_RECORD_HEADERS = ['record_key', 'id', 'name', 'description', 'email', 'location', 'type'] as const;
export const LEGACY_RELATIONSHIP_HEADERS = ['relationship_key', 'source_ref', 'target_ref', 'type'] as const;

// Kept as an alias for callers that used the previous name.
export const RECORD_HEADERS = CONTACT_HEADERS;

const typeAliases: Record<string, RecordType> = {
  person: 'person',
  persona: 'person',
  company: 'company',
  empresa: 'company',
  ecosistema: 'company',
  institution: 'institution',
  institucion: 'institution',
  institución: 'institution',
  proyecto: 'institution',
};

function issue(
  severity: ImportIssue['severity'],
  code: ImportIssue['code'],
  message: string,
  details: Omit<ImportIssue, 'severity' | 'code' | 'message'> = {}
): ImportIssue {
  return { severity, code, message, ...details };
}

function normalizedForComparison(value: string) {
  return value.trim().toLocaleLowerCase('es-AR');
}

function normalizeHeaders(headers: string[]) {
  return headers.map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase());
}

function isLegacyRecordsFile(file: ParsedCsvFile) {
  return file.headers.includes('record_key') || file.headers.includes('id');
}

function isLegacyRelationshipsFile(file: ParsedCsvFile) {
  return file.headers.includes('source_ref') || file.headers.includes('target_ref');
}

function expectedSchema(file: ParsedCsvFile, kind: BulkImportFileKind) {
  if (kind === 'records') {
    return isLegacyRecordsFile(file)
      ? { required: LEGACY_RECORD_HEADERS, allowed: LEGACY_RECORD_HEADERS }
      : { required: ['name', 'type'] as const, allowed: CONTACT_HEADERS };
  }

  return isLegacyRelationshipsFile(file)
    ? { required: LEGACY_RELATIONSHIP_HEADERS, allowed: LEGACY_RELATIONSHIP_HEADERS }
    : {
        required: RELATIONSHIP_HEADERS,
        allowed: [...RELATIONSHIP_HEADERS, 'relationship_key'] as const,
      };
}

function validateHeaders(file: ParsedCsvFile | undefined, kind: BulkImportFileKind) {
  const issues: ImportIssue[] = [];

  if (!file) {
    return issues;
  }

  if (file.parseIssues.length > 0) {
    issues.push(
      ...file.parseIssues.map((parseIssue) =>
        issue('error', 'invalid-csv', parseIssue.message, {
          rowNumber: parseIssue.rowNumber,
          fileKind: kind,
        })
      )
    );
  }

  if (file.headers.length === 0) {
    issues.push(issue('error', 'empty-file', 'El archivo no contiene encabezados ni filas.', { fileKind: kind }));
    return issues;
  }

  if (file.rows.length === 0) {
    issues.push(issue('error', 'empty-file', 'El archivo solo contiene encabezados y no tiene filas de datos.', { fileKind: kind }));
  }

  const headers = normalizeHeaders(file.headers);
  const schema = expectedSchema({ ...file, headers }, kind);
  const allowed = new Set<string>(schema.allowed);
  const seen = new Set<string>();

  headers.forEach((header) => {
    if (seen.has(header)) {
      issues.push(issue('error', 'duplicate-header', `El encabezado "${header}" está repetido.`, { column: header, fileKind: kind }));
    }
    seen.add(header);

    if (!allowed.has(header)) {
      issues.push(issue('error', 'unknown-header', `El encabezado "${header}" no es reconocido.`, { column: header, fileKind: kind }));
    }
  });

  schema.required.forEach((header) => {
    if (!seen.has(header)) {
      issues.push(issue('error', 'missing-header', `Falta la columna obligatoria "${header}".`, { column: header, fileKind: kind }));
    }
  });

  file.rawHeaders.forEach((header, index) => {
    if (header !== headers[index]) {
      issues.push(issue('warning', 'normalized-value', `El encabezado "${header}" se normalizó como "${headers[index]}".`, { column: headers[index], fileKind: kind }));
    }
  });

  return issues;
}

function value(row: CsvRow, key: string) {
  return (row.values[key] ?? '').replace(/^\uFEFF/, '').trim();
}

function withRowContext(current: ImportIssue[], fileKind: BulkImportFileKind, rowNumber: number) {
  return current.map((currentIssue) => ({
    ...currentIssue,
    fileKind,
    rowNumber: currentIssue.rowNumber ?? rowNumber,
  }));
}

function normalizeRecordType(rawValue: string) {
  const normalized = typeAliases[normalizedForComparison(rawValue)];

  if (!normalized) {
    return {
      value: '' as RecordType | '',
      issues: [issue('error', 'invalid-record-type', `Tipo de registro inválido: "${rawValue}".`, { column: 'type' })],
    };
  }

  return {
    value: normalized,
    issues: rawValue.trim() !== normalized
      ? [issue('warning', 'normalized-value', `El tipo "${rawValue}" se normalizó como "${normalized}".`, { column: 'type' })]
      : [],
  };
}

function normalizeRelationshipType(rawValue: string) {
  const normalized = relationshipTypes.find(
    (relationshipType) => normalizedForComparison(relationshipType) === normalizedForComparison(rawValue)
  ) as RelationshipType | undefined;

  if (!normalized) {
    return {
      value: '' as RelationshipType | '',
      issues: [issue('error', 'invalid-relationship-type', `Tipo de relación inválido: "${rawValue}".`, { column: 'type' })],
    };
  }

  return {
    value: normalized,
    issues: rawValue.trim() !== normalized
      ? [issue('warning', 'normalized-value', `El tipo "${rawValue}" se normalizó como "${normalized}".`, { column: 'type' })]
      : [],
  };
}

function validateEmail(rawValue: string) {
  if (!rawValue) {
    return [];
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawValue)
    ? []
    : [issue('error', 'invalid-email', 'El email no tiene un formato válido.', { column: 'email' })];
}

function validateRecordRows(file: ParsedCsvFile | undefined) {
  const rows: ImportPreviewRow[] = [];
  const issues: ImportIssue[] = [];
  const keys = new Map<string, number>();
  const ids = new Map<string, number>();
  const names = new Map<string, number>();

  if (!file) {
    return { rows, issues, keys };
  }

  const legacy = isLegacyRecordsFile(file);

  file.rows.forEach((row) => {
    const rowIssues: ImportIssue[] = [];
    const inputRecordKey = value(row, 'record_key');
    const recordKey = inputRecordKey || `__import_record_${row.rowNumber}`;
    const id = value(row, 'id');
    const name = value(row, 'name');
    const description = value(row, 'description');
    const email = value(row, 'email');
    const location = value(row, 'location');
    const rawType = value(row, 'type');

    (legacy ? (['record_key', 'name', 'type'] as const) : (['name', 'type'] as const)).forEach((field) => {
      if (!value(row, field)) {
        rowIssues.push(issue('error', 'required-field', `El campo "${field}" es obligatorio.`, { column: field }));
      }
    });

    const previousKey = keys.get(recordKey);
    if (previousKey) {
      rowIssues.push(issue('error', 'duplicate-key', `La clave interna se repite; también aparece en la fila ${previousKey}.`, { column: legacy ? 'record_key' : 'name' }));
    } else {
      keys.set(recordKey, row.rowNumber);
    }

    if (id) {
      const previous = ids.get(id);
      if (previous) {
        rowIssues.push(issue('error', 'duplicate-key', `ID repetido; también aparece en la fila ${previous}.`, { column: 'id' }));
      } else {
        ids.set(id, row.rowNumber);
      }
    }

    const normalizedName = normalizedForComparison(name);
    if (normalizedName) {
      const previousName = names.get(normalizedName);
      if (previousName) {
        rowIssues.push(issue(
          'error',
          'duplicate-name',
          `El nombre "${name}" está repetido; también aparece en la fila ${previousName}.`,
          { column: 'name' }
        ));
      } else {
        names.set(normalizedName, row.rowNumber);
      }
    }

    if (row.fieldCount !== file.headers.length) {
      rowIssues.push(issue('error', 'malformed-row', 'La fila no tiene la misma cantidad de columnas que el encabezado.'));
    }

    const typeResult = normalizeRecordType(rawType);
    rowIssues.push(...typeResult.issues, ...validateEmail(email));

    const normalizedValues: CsvValues = { record_key: recordKey, id, name, description, email, location, type: typeResult.value, __legacy: legacy ? 'true' : '' };
    const hasTrimCorrection = Object.entries(row.values).some(
      ([field, rawValue]) => rawValue !== normalizedValues[field] && field !== 'type'
    );

    if (hasTrimCorrection) {
      rowIssues.push(issue('warning', 'normalized-value', 'Se quitaron espacios al inicio o al final de uno o más valores.'));
    }

    const contextualIssues = withRowContext(rowIssues, 'records', row.rowNumber);
    rows.push({ fileKind: 'records', fileName: file.file.name, rowNumber: row.rowNumber, values: normalizedValues, issues: contextualIssues });
    issues.push(...contextualIssues);
  });

  return { rows, issues, keys };
}

function validateRelationshipRows(file: ParsedCsvFile | undefined, recordKeys: Map<string, number>) {
  const rows: ImportPreviewRow[] = [];
  const issues: ImportIssue[] = [];
  const keys = new Map<string, number>();

  if (!file) {
    return { rows, issues };
  }

  const legacy = isLegacyRelationshipsFile(file);

  file.rows.forEach((row) => {
    const rowIssues: ImportIssue[] = [];
    const relationshipKey = value(row, 'relationship_key');
    const sourceRef = value(row, legacy ? 'source_ref' : 'source');
    const targetRef = value(row, legacy ? 'target_ref' : 'target');
    const rawType = value(row, 'type');

    (legacy ? (['relationship_key', 'source_ref', 'target_ref', 'type'] as const) : (['source', 'target', 'type'] as const)).forEach((field) => {
      if (!value(row, field)) {
        rowIssues.push(issue('error', 'required-field', `El campo "${field}" es obligatorio.`, { column: field }));
      }
    });

    if (relationshipKey) {
      const previous = keys.get(relationshipKey);
      if (previous) {
        rowIssues.push(issue('error', 'duplicate-key', `relationship_key repetido; también aparece en la fila ${previous}.`, { column: 'relationship_key' }));
      } else {
        keys.set(relationshipKey, row.rowNumber);
      }
    }

    if (row.fieldCount !== file.headers.length) {
      rowIssues.push(issue('error', 'malformed-row', 'La fila no tiene la misma cantidad de columnas que el encabezado.'));
    }

    if (legacy) {
      ([['source_ref', sourceRef], ['target_ref', targetRef]] as const).forEach(([column, reference]) => {
        if (!reference) return;
        if (reference.startsWith('id:')) {
          rowIssues.push(issue('warning', 'pending-database-reference', `La referencia "${reference}" se validará contra D1.`, { column }));
        } else if (!recordKeys.has(reference)) {
          rowIssues.push(issue('error', 'missing-reference', `La referencia "${reference}" no existe en el archivo de registros.`, { column }));
        }
      });
    }

    const typeResult = normalizeRelationshipType(rawType);
    rowIssues.push(...typeResult.issues);

    const normalizedValues: CsvValues = {
      relationship_key: relationshipKey,
      source: sourceRef,
      target: targetRef,
      source_ref: sourceRef,
      target_ref: targetRef,
      type: typeResult.value,
      __legacy: legacy ? 'true' : '',
    };

    const hasTrimCorrection = Object.entries(row.values).some(
      ([field, rawValue]) => rawValue !== normalizedValues[field] && field !== 'type'
    );
    if (hasTrimCorrection) {
      rowIssues.push(issue('warning', 'normalized-value', 'Se quitaron espacios al inicio o al final de uno o más valores.'));
    }

    const contextualIssues = withRowContext(rowIssues, 'relationships', row.rowNumber);
    rows.push({ fileKind: 'relationships', fileName: file.file.name, rowNumber: row.rowNumber, values: normalizedValues, issues: contextualIssues });
    issues.push(...contextualIssues);
  });

  return { rows, issues };
}

export function validateBulkImport(recordsFile: ParsedCsvFile | undefined, relationshipsFile: ParsedCsvFile | undefined): BulkImportValidation {
  const fileIssues = [
    ...validateHeaders(recordsFile, 'records'),
    ...validateHeaders(relationshipsFile, 'relationships'),
  ];
  const records = validateRecordRows(recordsFile);
  const relationships = validateRelationshipRows(relationshipsFile, records.keys);
  const issues = [...fileIssues, ...records.issues, ...relationships.issues];
  const rows = [...records.rows, ...relationships.rows];
  const rowsWithWarnings = new Set(
    rows.filter((row) => row.issues.some((rowIssue) => rowIssue.severity === 'warning')).map((row) => `${row.fileKind}:${row.rowNumber}`)
  );

  if (rows.length === 0) {
    issues.push(issue('error', 'empty-file', 'Seleccioná al menos un archivo CSV con datos.'));
  }

  return {
    rows,
    issues,
    blockingErrorCount: issues.filter((currentIssue) => currentIssue.severity === 'error').length,
    warningCount: issues.filter((currentIssue) => currentIssue.severity === 'warning').length,
    validRowCount: rows.filter((row) => !row.issues.some((currentIssue) => currentIssue.severity === 'error')).length,
    correctedRowCount: rowsWithWarnings.size,
    recordsCount: records.rows.length,
    relationshipsCount: relationships.rows.length,
  };
}
