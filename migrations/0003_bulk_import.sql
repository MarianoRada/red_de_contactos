-- Preflight required before applying this migration:
-- SELECT source_id, target_id, type, COUNT(*) AS duplicate_count
-- FROM relationships
-- GROUP BY source_id, target_id, type
-- HAVING COUNT(*) > 1;
--
-- The unique index below intentionally fails if duplicate data exists.
-- Existing data must be reviewed and resolved manually; this migration
-- never deletes or rewrites existing relationships.

CREATE TABLE IF NOT EXISTS import_operations (
    import_id TEXT PRIMARY KEY,
    payload_hash TEXT NOT NULL,
    records_count INTEGER NOT NULL,
    relationships_count INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_unique_directed
ON relationships(source_id, target_id, type);
