import { consolidateBlockingErrors } from '../src/lib/bulkImportCounters.ts';
import { countValidRecordRows } from '../src/lib/bulkImportValidationMetrics.ts';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const combinedErrors = consolidateBlockingErrors({
  validationIssues: [],
  recordNameConflicts: Array.from({ length: 20 }, (_, index) => ({
    row: index + 2,
    name: `Contacto ${index + 1}`,
  })),
  resolutionIssues: Array.from({ length: 25 }, (_, index) => ({
    row: index + 2,
    message: 'Esta relación ya existe.',
  })),
  serverIssues: [],
});
assert(combinedErrors.length === 45, 'Combined contact and relationship conflicts should count as 45 errors.');

const deduplicatedErrors = consolidateBlockingErrors({
  validationIssues: [],
  recordNameConflicts: [{ row: 2, name: 'Lucía Ferraro' }],
  resolutionIssues: [{ row: 2, message: 'Esta relación ya existe.' }],
  serverIssues: [
    {
      fileKind: 'records',
      row: 2,
      column: 'name',
      code: 'record_name_conflict',
      message: '"Lucía Ferraro" ya existe.',
    },
    {
      fileKind: 'relationships',
      row: 2,
      code: 'relationship_conflict',
      message: 'Esta relación ya existe.',
    },
  ],
});
assert(deduplicatedErrors.length === 2, 'Equivalent frontend and backend errors should not be counted twice.');

const structuralAndWarningErrors = consolidateBlockingErrors({
  validationIssues: [
    {
      severity: 'error',
      code: 'required-field',
      message: 'El campo "name" es obligatorio.',
      fileKind: 'records',
      rowNumber: 3,
      column: 'name',
    },
    {
      severity: 'warning',
      code: 'normalized-value',
      message: 'Se quitaron espacios.',
      fileKind: 'records',
      rowNumber: 4,
    },
  ],
  recordNameConflicts: [],
  resolutionIssues: [],
  serverIssues: [],
});
assert(structuralAndWarningErrors.length === 1, 'Warnings must not increase the blocking error counter.');

const genericBackendError = consolidateBlockingErrors({
  validationIssues: [],
  recordNameConflicts: [],
  resolutionIssues: [],
  serverIssues: [],
  importError: 'No se pudo completar la importación.',
});
assert(genericBackendError.length === 1, 'A generic backend error should be represented once.');

const invalidRecordRows = [
  {
    fileKind: 'records',
    fileName: 'contacts.csv',
    rowNumber: 2,
    values: {},
    issues: [{ severity: 'error' }],
  },
  {
    fileKind: 'records',
    fileName: 'contacts.csv',
    rowNumber: 3,
    values: {},
    issues: [{ severity: 'error' }],
  },
];
assert(countValidRecordRows(invalidRecordRows) === 0, 'Rows with validation errors must not count towards valid contacts.');

const mixedRecordRows = [
  ...invalidRecordRows,
  {
    fileKind: 'records',
    fileName: 'contacts.csv',
    rowNumber: 4,
    values: { name: 'Contacto valido' },
    issues: [],
  },
];
assert(countValidRecordRows(mixedRecordRows) === 1, 'Mixed files must count only valid contact rows.');

const missingNameErrors = consolidateBlockingErrors({
  validationIssues: [
    {
      severity: 'error',
      code: 'missing-header',
      message: 'Falta la columna obligatoria name.',
      fileKind: 'records',
      column: 'name',
    },
    {
      severity: 'error',
      code: 'required-field',
      message: 'El campo name es obligatorio.',
      fileKind: 'records',
      rowNumber: 2,
      column: 'name',
    },
    {
      severity: 'error',
      code: 'required-field',
      message: 'El campo name es obligatorio.',
      fileKind: 'records',
      rowNumber: 3,
      column: 'name',
    },
  ],
  recordNameConflicts: [],
  resolutionIssues: [],
  serverIssues: [],
});
assert(missingNameErrors.length === 3, 'Missing-name CSV must expose all 3 blocking contact errors.');
assert(missingNameErrors.every((error) => error.fileKind === 'records'), 'Missing-name errors must be classified as contact errors.');

const missingTypeErrors = consolidateBlockingErrors({
  validationIssues: [
    {
      severity: 'error',
      code: 'missing-header',
      message: 'Falta la columna obligatoria type.',
      fileKind: 'records',
      column: 'type',
    },
    ...[2, 3].flatMap((rowNumber) => [
      {
        severity: 'error',
        code: 'required-field',
        message: 'El campo type es obligatorio.',
        fileKind: 'records',
        rowNumber,
        column: 'type',
      },
      {
        severity: 'error',
        code: 'invalid-record-type',
        message: 'El tipo de contacto no es válido.',
        fileKind: 'records',
        rowNumber,
        column: 'type',
      },
    ]),
  ],
  recordNameConflicts: [],
  resolutionIssues: [],
  serverIssues: [],
});
assert(missingTypeErrors.length === 5, 'Missing-type CSV must expose all 5 blocking contact errors.');
assert(missingTypeErrors.every((error) => error.fileKind === 'records'), 'Missing-type errors must be classified as contact errors.');

const relationshipErrors = consolidateBlockingErrors({
  validationIssues: [
    {
      severity: 'error',
      code: 'missing-reference',
      message: 'No existe un contacto de origen.',
      fileKind: 'relationships',
      rowNumber: 2,
    },
  ],
  recordNameConflicts: [],
  resolutionIssues: [],
  serverIssues: [],
});
assert(relationshipErrors.length === 1 && relationshipErrors[0].fileKind === 'relationships', 'Relationship errors must remain in the relationship section.');

console.log('Bulk import counter tests passed: aggregation, deduplication, warnings, and backend errors.');
