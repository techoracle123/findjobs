-- Quality metadata. The KV publication is the durable store; this table mirrors
-- per-field completeness for the database path and the admin wallboard.
ALTER TABLE jobs ADD COLUMN language TEXT;
ALTER TABLE jobs ADD COLUMN language_required TEXT;
ALTER TABLE jobs ADD COLUMN normalizer_version TEXT;
ALTER TABLE jobs ADD COLUMN quality TEXT;

CREATE TABLE IF NOT EXISTS field_quality (
  run_date  TEXT NOT NULL,
  source_id TEXT NOT NULL,
  field     TEXT NOT NULL,
  total     INTEGER NOT NULL,
  populated INTEGER NOT NULL,
  pct       REAL NOT NULL,
  PRIMARY KEY (run_date, source_id, field)
);

CREATE INDEX IF NOT EXISTS idx_field_quality_date ON field_quality(run_date);
