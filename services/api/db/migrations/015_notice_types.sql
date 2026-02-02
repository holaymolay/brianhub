PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notice_types (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notice_types_workspace_key ON notice_types(workspace_id, key);
CREATE INDEX IF NOT EXISTS idx_notice_types_workspace ON notice_types(workspace_id);

INSERT OR IGNORE INTO notice_types (id, workspace_id, key, label, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, 'general', 'General', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM workspaces;

INSERT OR IGNORE INTO notice_types (id, workspace_id, key, label, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, 'bill', 'Bill notice', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM workspaces;

INSERT OR IGNORE INTO notice_types (id, workspace_id, key, label, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, 'auto-payment', 'Auto-payment notice', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM workspaces;
