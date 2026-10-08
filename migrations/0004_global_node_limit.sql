-- Enforce the product-wide maximum at the database boundary.
-- The trigger runs for every inserted row, including INSERT ... SELECT and
-- concurrent requests serialized by D1, so a preflight COUNT cannot bypass it.
CREATE TRIGGER IF NOT EXISTS enforce_max_records
BEFORE INSERT ON records
WHEN (SELECT COUNT(*) FROM records) >= 1000
BEGIN
  SELECT RAISE(ABORT, 'MAX_NODES_EXCEEDED');
END;
