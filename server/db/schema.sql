CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  zone_count INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_worlds_author ON worlds(author_id);
CREATE INDEX IF NOT EXISTS idx_worlds_updated ON worlds(updated_at DESC);
