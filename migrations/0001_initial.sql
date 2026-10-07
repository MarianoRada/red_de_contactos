CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    email TEXT,
    location TEXT,
    type TEXT NOT NULL CHECK (
        type IN ('person', 'company', 'institution')
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (
        type IN (
            'colabora con',
            'trabaja en',
            'participa en',
            'forma parte de',
            'coordina',
            'representa a',
            'financia',
            'está relacionado con'
        )
    ),

    FOREIGN KEY (source_id)
        REFERENCES records(id)
        ON DELETE CASCADE,

    FOREIGN KEY (target_id)
        REFERENCES records(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_records_type
ON records(type);

CREATE INDEX IF NOT EXISTS idx_relationships_source
ON relationships(source_id);

CREATE INDEX IF NOT EXISTS idx_relationships_target
ON relationships(target_id);