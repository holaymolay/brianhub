PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN org_role TEXT NOT NULL DEFAULT 'member';

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_owner_settings (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  owner_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
