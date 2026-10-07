CREATE TABLE IF NOT EXISTS node_positions (
    record_id TEXT PRIMARY KEY,
    x REAL NOT NULL,
    y REAL NOT NULL,

    FOREIGN KEY (record_id)
        REFERENCES records(id)
        ON DELETE CASCADE
);