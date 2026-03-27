PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS service_account_activity_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  service_account_id TEXT NOT NULL,
  token_id TEXT,
  workspace_id TEXT,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  request_method TEXT,
  request_path TEXT,
  status_code INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (service_account_id) REFERENCES service_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (token_id) REFERENCES api_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_service_account_activity_account_created
  ON service_account_activity_events(service_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_account_activity_token_created
  ON service_account_activity_events(token_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_account_activity_workspace_created
  ON service_account_activity_events(workspace_id, created_at DESC);
