-- Allow all 12 upload categories. The original table only allowed
-- classic, costume, and chaos, so uploads in any other category failed.
-- SQLite can't alter a CHECK constraint, so rebuild the table and copy every row.
--
-- approved: 1 = live, 0 = deleted, 2 = waiting for review (auto-mod unsure).

CREATE TABLE goobers_new (
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

INSERT INTO goobers_new (id, name, category, description, image_key, image_type, approved, created_at)
SELECT
  id,
  name,
  CASE
    WHEN category IN ('classic', 'costume', 'chaos', 'funny', 'spooky', 'animal', 'food', 'sports', 'holiday', 'fancy', 'superhero', 'random')
    THEN category
    ELSE 'random'
  END,
  description,
  image_key,
  image_type,
  approved,
  created_at
FROM goobers;

DROP TABLE goobers;

ALTER TABLE goobers_new RENAME TO goobers;

CREATE INDEX IF NOT EXISTS idx_goobers_approved_created
ON goobers (approved, created_at);
