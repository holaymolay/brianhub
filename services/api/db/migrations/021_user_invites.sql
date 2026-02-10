PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_invites (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invite_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  invited_by_email TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_invites_org_status ON user_invites(org_id, status);
CREATE INDEX IF NOT EXISTS idx_user_invites_workspace_status ON user_invites(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_user_invites_email_status ON user_invites(email, status);
CREATE INDEX IF NOT EXISTS idx_user_invites_expires_at ON user_invites(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invites_workspace_email_pending
  ON user_invites(workspace_id, email)
  WHERE status = 'pending';
