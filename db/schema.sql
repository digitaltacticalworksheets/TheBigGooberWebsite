-- Full schema for a fresh database. Existing databases are updated with
-- the files in /migrations (wrangler d1 migrations apply).
--
-- approved: 1 = live, 0 = deleted, 2 = waiting for review (auto-mod unsure).
CREATE TABLE IF NOT EXISTS goobers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'classic', 'costume', 'chaos', 'funny', 'spooky', 'animal',
    'food', 'sports', 'holiday', 'fancy', 'superhero', 'random'
  )),
  description TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_type TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_goobers_approved_created
ON goobers (approved, created_at);
