PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  description_md TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace_parent ON tasks(workspace_id, parent_id);
