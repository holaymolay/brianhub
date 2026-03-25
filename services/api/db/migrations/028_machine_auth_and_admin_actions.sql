PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_machine_actors (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  principal TEXT NOT NULL,
  display_name TEXT NOT NULL,
  org_role TEXT NOT NULL DEFAULT 'member',
  all_workspaces INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_machine_actors_org_principal
  ON auth_machine_actors(org_id, principal);
CREATE INDEX IF NOT EXISTS idx_auth_machine_actors_org_role
  ON auth_machine_actors(org_id, org_role);

CREATE TABLE IF NOT EXISTS auth_machine_tokens (
  id TEXT PRIMARY KEY,
  machine_actor_id TEXT NOT NULL,
  label TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (machine_actor_id) REFERENCES auth_machine_actors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_machine_tokens_actor
  ON auth_machine_tokens(machine_actor_id);
CREATE INDEX IF NOT EXISTS idx_auth_machine_tokens_expires
  ON auth_machine_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_machine_tokens_revoked
  ON auth_machine_tokens(revoked_at);

CREATE TABLE IF NOT EXISTS auth_machine_workspace_grants (
  id TEXT PRIMARY KEY,
  machine_actor_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (machine_actor_id, workspace_id),
  FOREIGN KEY (machine_actor_id) REFERENCES auth_machine_actors(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_machine_workspace_grants_actor
  ON auth_machine_workspace_grants(machine_actor_id);
CREATE INDEX IF NOT EXISTS idx_auth_machine_workspace_grants_workspace
  ON auth_machine_workspace_grants(workspace_id);

CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT,
  requested_by_type TEXT NOT NULL,
  requested_by_id TEXT,
  requested_by_label TEXT NOT NULL,
  source_channel TEXT,
  source_principal TEXT,
  action_type TEXT NOT NULL,
  target TEXT,
  arguments_json TEXT NOT NULL DEFAULT '{}',
  approval_mode TEXT NOT NULL DEFAULT 'explicit',
  status TEXT NOT NULL DEFAULT 'requested',
  approved_by_type TEXT,
  approved_by_id TEXT,
  approved_by_label TEXT,
  result_json TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  executed_at TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_org_status_created
  ON admin_actions(org_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_workspace_status_created
  ON admin_actions(workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type_created
  ON admin_actions(action_type, created_at);
