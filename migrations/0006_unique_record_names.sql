-- Preflight verified on the current local and remote D1 databases:
-- SELECT lower(trim(name)), COUNT(*) FROM records
-- GROUP BY lower(trim(name)) HAVING COUNT(*) > 1;
--
-- The query returned no rows. If this migration is ever applied to a database
-- containing duplicates, SQLite will abort it without deleting or renaming
-- records. Duplicates must then be resolved manually with their relationships
-- preserved before retrying the migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_records_unique_normalized_name
ON records(lower(trim(name)));

