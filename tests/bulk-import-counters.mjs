import { consolidateBlockingErrors } from '../src/lib/bulkImportCounters.ts';

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

console.log('Bulk import counter tests passed: aggregation, deduplication, warnings, and backend errors.');
