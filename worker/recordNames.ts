export type RecordNameConflict = {
  id: string;
  name: string;
};

export function normalizeRecordName(value: string) {
  return value.trim().toLocaleLowerCase('es-AR');
}

export async function findRecordNameConflict(
  db: D1Database,
  name: string,
  excludedId?: string
): Promise<RecordNameConflict | undefined> {
  const { results } = await db
    .prepare('SELECT id, name FROM records')
    .all<RecordNameConflict>();

  const normalized = normalizeRecordName(name);

  return results.find(
    (record) =>
      record.id !== excludedId &&
      normalizeRecordName(record.name) === normalized
  );
}

export function isRecordNameUniqueViolation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /idx_records_unique_normalized_name|UNIQUE constraint failed/i.test(message);
}

