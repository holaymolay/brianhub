PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO orgs (id, name, created_at, updated_at)
VALUES ('org-default', 'Default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

ALTER TABLE workspaces ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org-default';

CREATE INDEX IF NOT EXISTS idx_workspaces_org ON workspaces(org_id);
