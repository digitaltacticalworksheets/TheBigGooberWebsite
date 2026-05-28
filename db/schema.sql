CREATE TABLE IF NOT EXISTS goobers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('classic', 'costume', 'chaos')),
  description TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_type TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_goobers_approved_created
ON goobers (approved, created_at);
