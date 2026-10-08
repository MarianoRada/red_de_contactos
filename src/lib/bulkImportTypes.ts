import type {
  RecordType,
  RelationshipType,
} from '../types/models';

export type BulkImportFileKind = 'records' | 'relationships';

export type ImportIssueSeverity = 'error' | 'warning';

export type ImportIssueCode =
  | 'empty-file'
  | 'invalid-csv'
  | 'missing-header'
  | 'unknown-header'
  | 'duplicate-header'
  | 'malformed-row'
  | 'required-field'
  | 'invalid-record-type'
  | 'invalid-relationship-type'
  | 'duplicate-key'
  | 'invalid-email'
  | 'missing-reference'
  | 'self-relationship'
  | 'duplicate-relationship'
  | 'pending-database-reference'
  | 'normalized-value';

export type CsvValues = Record<string, string>;

export type CsvRow = {
  rowNumber: number;
  values: CsvValues;
  fieldCount: number;
};

export type CsvParseIssue = {
  rowNumber?: number;
  message: string;
};

export type ParsedCsvFile = {
  file: File;
  rawHeaders: string[];
  headers: string[];
  rows: CsvRow[];
  delimiter?: string;
  parseIssues: CsvParseIssue[];
};

export type ImportIssue = {
  severity: ImportIssueSeverity;
  code: ImportIssueCode;
  message: string;
  rowNumber?: number;
  column?: string;
  fileKind?: BulkImportFileKind;
};

export type ImportPreviewRow = {
  fileKind: BulkImportFileKind;
  fileName: string;
  rowNumber: number;
  values: CsvValues;
  issues: ImportIssue[];
};

export type NormalizedRecordRow = {
  record_key: string;
  id: string;
  name: string;
  description: string;
  email: string;
  location: string;
  type: RecordType | '';
};

export type NormalizedRelationshipRow = {
  relationship_key: string;
  source_ref: string;
  target_ref: string;
  type: RelationshipType | '';
};

export type BulkImportValidation = {
  rows: ImportPreviewRow[];
  issues: ImportIssue[];
  blockingErrorCount: number;
  warningCount: number;
  validRowCount: number;
  correctedRowCount: number;
  recordsCount: number;
  relationshipsCount: number;
};

export type BulkImportRecordPayload = {
  record_key: string;
  id?: string;
  name: string;
  description?: string;
  email?: string;
  location?: string;
  type: RecordType;
};

export type BulkImportRelationshipPayload = {
  relationship_key: string;
  source_ref: string;
  target_ref: string;
  type: RelationshipType;
};

export type BulkImportPayload = {
  importId: string;
  records: BulkImportRecordPayload[];
  relationships: BulkImportRelationshipPayload[];
};

export type BulkImportResult = {
  success: boolean;
  idempotent: boolean;
  importId: string;
  inserted: {
    records: number;
    relationships: number;
  };
};
