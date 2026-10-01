-- Goober Hall of Fame: Goobers an admin has inducted, with an optional plaque note.
CREATE TABLE IF NOT EXISTS goober_fame (
  goober_id TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  inducted_by TEXT NOT NULL DEFAULT '',
  inducted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
