CREATE TABLE IF NOT EXISTS store_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_store_rules_workspace ON store_rules(workspace_id);
