PRAGMA foreign_keys = ON;

UPDATE workspaces
   SET owner_user_id = COALESCE(
     (
       SELECT u.id
         FROM change_log cl
         JOIN users u ON u.id = cl.entity_id
        WHERE cl.workspace_id = workspaces.id
          AND cl.entity_type = 'user'
          AND cl.action = 'create'
          AND u.archived = 0
        ORDER BY cl.created_at ASC, cl.seq ASC
        LIMIT 1
     ),
     (
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
     ),
     (
       SELECT CASE
                WHEN COUNT(*) = 1 THEN MIN(wm.user_id)
                ELSE NULL
              END
         FROM workspace_memberships wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = workspaces.id
          AND wm.archived = 0
          AND u.archived = 0
          AND (
            workspaces.owner_user_id IS NULL
            OR workspaces.owner_user_id = (
              SELECT owner_user_id
                FROM orgs
               WHERE id = workspaces.org_id
            )
          )
          AND wm.user_id <> COALESCE((
            SELECT owner_user_id
              FROM orgs
             WHERE id = workspaces.org_id
          ), '')
     ),
     owner_user_id,
     (
       SELECT wm.user_id
         FROM workspace_memberships wm
         JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = workspaces.id
          AND wm.archived = 0
          AND u.archived = 0
        ORDER BY wm.created_at ASC, wm.id ASC
        LIMIT 1
     )
   )
 WHERE lower(coalesce(type, 'personal')) = 'personal';
