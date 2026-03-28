PRAGMA foreign_keys = ON;

ALTER TABLE workspaces ADD COLUMN owner_user_id TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_user ON workspaces(owner_user_id);

UPDATE workspaces
   SET owner_user_id = (
     SELECT u.id
       FROM user_invites ui
       JOIN users u
         ON u.org_id = ui.org_id
        AND lower(u.email) = lower(ui.email)
      WHERE ui.workspace_id = workspaces.id
        AND ui.status = 'accepted'
        AND u.archived = 0
      ORDER BY COALESCE(ui.accepted_at, ui.created_at) ASC, ui.created_at ASC, ui.id ASC
      LIMIT 1
   )
 WHERE lower(coalesce(type, 'personal')) = 'personal'
   AND owner_user_id IS NULL;

UPDATE workspaces
   SET owner_user_id = (
     SELECT wm.user_id
       FROM workspace_memberships wm
       JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = workspaces.id
        AND wm.archived = 0
        AND u.archived = 0
      ORDER BY wm.created_at ASC, wm.id ASC
      LIMIT 1
   )
 WHERE lower(coalesce(type, 'personal')) = 'personal'
   AND owner_user_id IS NULL;
