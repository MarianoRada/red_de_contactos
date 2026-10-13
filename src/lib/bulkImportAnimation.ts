import type { BulkImportResult } from './bulkImportTypes';

export function shouldReplayGraphIntro(result: Pick<BulkImportResult, 'idempotent' | 'inserted'>) {
  return (
    !result.idempotent &&
    (result.inserted.records > 0 || result.inserted.relationships > 0)
  );
}
