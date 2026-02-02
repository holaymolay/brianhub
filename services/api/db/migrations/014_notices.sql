PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notice_type TEXT NOT NULL DEFAULT 'general',
  notify_at TEXT NOT NULL,
  notice_sent_at TEXT,
  dismissed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notices_workspace ON notices(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notices_notify_at ON notices(notify_at);
CREATE INDEX IF NOT EXISTS idx_notices_dismissed ON notices(dismissed_at);
