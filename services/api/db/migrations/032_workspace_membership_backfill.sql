PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO workspace_memberships (
  id,
  workspace_id,
  user_id,
  role,
  archived,
  created_at,
  updated_at
)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  w.id,
  o.owner_user_id,
  CASE WHEN lower(coalesce(w.type, 'personal')) = 'shared' THEN 'manager' ELSE 'member' END,
  0,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM workspaces w
JOIN orgs o ON o.id = w.org_id
JOIN users owner ON owner.id = o.owner_user_id
LEFT JOIN workspace_memberships wm
  ON wm.workspace_id = w.id
 AND wm.archived = 0
WHERE w.archived = 0
  AND owner.archived = 0
  AND wm.id IS NULL;
