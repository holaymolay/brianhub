PRAGMA foreign_keys = ON;

ALTER TABLE orgs ADD COLUMN owner_user_id TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_orgs_owner_user ON orgs(owner_user_id);

CREATE TABLE IF NOT EXISTS org_memberships (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON org_memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships(user_id);

INSERT OR IGNORE INTO org_memberships (
  id,
  org_id,
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
  u.org_id,
  u.id,
  CASE
    WHEN lower(trim(COALESCE(u.email, ''))) = lower(trim(COALESCE((
      SELECT owner_email FROM app_owner_settings WHERE singleton_id = 1
    ), ''))) THEN 'owner'
    WHEN lower(trim(COALESCE(u.org_role, ''))) = 'admin' THEN 'admin'
    ELSE 'member'
  END,
  0,
  COALESCE(u.created_at, CURRENT_TIMESTAMP),
  COALESCE(u.updated_at, CURRENT_TIMESTAMP)
FROM users u;

UPDATE orgs
   SET owner_user_id = COALESCE(
     owner_user_id,
     (
       SELECT om.user_id
         FROM org_memberships om
        WHERE om.org_id = orgs.id
          AND om.archived = 0
          AND om.role = 'owner'
        ORDER BY om.created_at ASC
        LIMIT 1
     ),
     (
       SELECT om.user_id
         FROM org_memberships om
        WHERE om.org_id = orgs.id
          AND om.archived = 0
          AND om.role = 'admin'
        ORDER BY om.created_at ASC
        LIMIT 1
     ),
     (
       SELECT om.user_id
         FROM org_memberships om
        WHERE om.org_id = orgs.id
          AND om.archived = 0
        ORDER BY om.created_at ASC
        LIMIT 1
     )
   )
 WHERE owner_user_id IS NULL;

UPDATE org_memberships
   SET role = 'owner',
       updated_at = CURRENT_TIMESTAMP
 WHERE archived = 0
   AND user_id = (
     SELECT o.owner_user_id
       FROM orgs o
      WHERE o.id = org_memberships.org_id
   )
   AND EXISTS (
     SELECT 1
       FROM orgs o
      WHERE o.id = org_memberships.org_id
        AND o.owner_user_id IS NOT NULL
   );
