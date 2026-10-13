import type { ImportPreviewRow } from './bulkImportTypes';

export function countValidRecordRows(rows: ImportPreviewRow[]) {
  return rows.filter(
    (row) =>
      row.fileKind === 'records' &&
      !row.issues.some((currentIssue) => currentIssue.severity === 'error')
  ).length;
}
