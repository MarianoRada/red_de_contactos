import type {
  BulkImportFileKind,
  ImportIssue,
} from './bulkImportTypes';

export type BlockingCounterIssue = {
  fileKind?: BulkImportFileKind;
  row?: number;
  column?: string;
  code: string;
  message: string;
};

export type BlockingCounterConflict = {
  row: number;
  name: string;
};

export type BlockingCounterResolutionIssue = {
  row: number;
  column?: string;
  message: string;
};

export type BlockingCounterServerIssue = {
  fileKind?: BulkImportFileKind;
  row?: number;
  column?: string;
  code?: string;
  message: string;
};

export function relationshipResolutionCode(message: string) {
  if (message.includes('ya existe')) {
    return 'relationship_conflict';
  }

  if (message.includes('repetida en el CSV')) {
    return 'duplicate_relationship';
  }

  if (message.includes('No existe un contacto')) {
    return 'missing-reference';
  }

  if (message.includes('duplicado en D1')) {
    return 'ambiguous-reference';
  }

  if (message.includes('no puede apuntar')) {
    return 'self-relationship';
  }

  return `relationship-resolution:${message}`;
}

export function serverIssueCode(issue: BlockingCounterServerIssue) {
  if (issue.code === 'duplicate_record_name') {
    return 'duplicate-name';
  }

  if (issue.code) {
    return issue.code;
  }

  return `backend-validation:${issue.message}`;
}

export function uniqueBlockingCounterIssues(issues: BlockingCounterIssue[]) {
  const seen = new Set<string>();

  return issues.filter((issue) => {
    const location = `${issue.fileKind ?? 'global'}:${issue.row ?? 'global'}:${issue.column ?? ''}`;
    const key = `${location}:${issue.code}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function consolidateBlockingErrors({
  validationIssues,
  recordNameConflicts,
  resolutionIssues,
  serverIssues,
  importError,
}: {
  validationIssues: ImportIssue[];
  recordNameConflicts: BlockingCounterConflict[];
  resolutionIssues: BlockingCounterResolutionIssue[];
  serverIssues: BlockingCounterServerIssue[];
  importError?: string;
}) {
  const issues: BlockingCounterIssue[] = validationIssues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => ({
      fileKind: issue.fileKind,
      row: issue.rowNumber,
      column: issue.column,
      code: issue.code,
      message: issue.message,
    }));

  issues.push(
    ...recordNameConflicts.map((conflict) => ({
      fileKind: 'records' as const,
      row: conflict.row,
      column: 'name',
      code: 'record_name_conflict',
      message: `"${conflict.name}" ya existe.`,
    })),
    ...resolutionIssues.map((issue) => ({
      fileKind: 'relationships' as const,
      row: issue.row,
      column: issue.column,
      code: relationshipResolutionCode(issue.message),
      message: issue.message,
    })),
    ...serverIssues.map((issue) => ({
      fileKind: issue.fileKind,
      row: issue.row,
      column: issue.column,
      code: serverIssueCode(issue),
      message: issue.message,
    }))
  );

  if (importError && serverIssues.length === 0) {
    issues.push({
      code: 'backend-error',
      message: importError,
    });
  }

  return uniqueBlockingCounterIssues(issues);
}
