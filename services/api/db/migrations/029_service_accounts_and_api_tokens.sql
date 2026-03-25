PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS service_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_accounts_org_archived_created
  ON service_accounts(org_id, archived, created_at);

CREATE TABLE IF NOT EXISTS service_account_aliases (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  service_account_id TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, alias_type, alias_value),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (service_account_id) REFERENCES service_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_account_aliases_account
  ON service_account_aliases(service_account_id, created_at);

CREATE TABLE IF NOT EXISTS service_account_workspace_grants (
  id TEXT PRIMARY KEY,
  service_account_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (service_account_id, workspace_id),
  FOREIGN KEY (service_account_id) REFERENCES service_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_account_workspace_grants_account
  ON service_account_workspace_grants(service_account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_service_account_workspace_grants_workspace
  ON service_account_workspace_grants(workspace_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  label TEXT,
  token_public_id TEXT NOT NULL UNIQUE,
  token_secret_hash TEXT NOT NULL,
  permission_constraints_json TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  rotated_from_token_id TEXT,
  replaced_by_token_id TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (rotated_from_token_id) REFERENCES api_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (replaced_by_token_id) REFERENCES api_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_owner
  ON api_tokens(owner_kind, owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_tokens_revoked
  ON api_tokens(revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_tokens_expires
  ON api_tokens(expires_at);

INSERT OR IGNORE INTO service_accounts (
  id, org_id, display_name, description, permissions_json, archived, created_at, updated_at
)
SELECT
  a.id,
  a.org_id,
  a.display_name,
  NULL,
  '["workspaces.read","tasks.read","tasks.create","tasks.update","tasks.delete","projects.read","projects.create","projects.update","projects.delete"]',
  a.archived,
  a.created_at,
  a.updated_at
FROM auth_machine_actors a;

INSERT OR IGNORE INTO service_account_aliases (
  id, org_id, service_account_id, alias_type, alias_value, metadata_json, created_at, updated_at
)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  a.org_id,
  a.id,
  'legacy_principal',
  a.principal,
  '{}',
  a.created_at,
  a.updated_at
FROM auth_machine_actors a;

INSERT OR IGNORE INTO service_account_workspace_grants (
  id, service_account_id, workspace_id, created_at, updated_at
)
SELECT
  g.id,
  g.machine_actor_id,
  g.workspace_id,
  g.created_at,
  g.updated_at
FROM auth_machine_workspace_grants g;

INSERT OR IGNORE INTO service_account_workspace_grants (
  id, service_account_id, workspace_id, created_at, updated_at
)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  a.id,
  w.id,
  a.created_at,
  a.updated_at
FROM auth_machine_actors a
JOIN workspaces w ON w.org_id = a.org_id
WHERE a.all_workspaces = 1;
