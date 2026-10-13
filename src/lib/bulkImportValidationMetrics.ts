import type { ImportPreviewRow } from './bulkImportTypes';

export function shouldReportEmptyImport(hasSelectedFile: boolean, rowCount: number) {
  return hasSelectedFile && rowCount === 0;
}

export function countValidRecordRows(rows: ImportPreviewRow[]) {
  return rows.filter(
    (row) =>
      row.fileKind === 'records' &&
      !row.issues.some((currentIssue) => currentIssue.severity === 'error')
  ).length;
}
