-- Who uploaded each Goober (shown as "Created by" on its card).
-- user_id is '' when the upload predates accounts, so it isn't looked up again.
CREATE TABLE IF NOT EXISTS goober_creators (
  goober_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL
);
