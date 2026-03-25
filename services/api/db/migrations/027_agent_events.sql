PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  target_agent TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal',
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  handled_at TEXT,
  error_text TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_events_workspace_status_created
  ON agent_events(workspace_id, status, created_at, id);

CREATE INDEX IF NOT EXISTS idx_agent_events_workspace_target_status_created
  ON agent_events(workspace_id, target_agent, status, created_at, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_events_workspace_target_dedupe
  ON agent_events(workspace_id, COALESCE(target_agent, ''), dedupe_key)
  WHERE dedupe_key IS NOT NULL;
