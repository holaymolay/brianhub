ALTER TABLE service_accounts ADD COLUMN created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_accounts_created_by_user
  ON service_accounts(created_by_user_id);

UPDATE service_accounts
   SET created_by_user_id = (
     SELECT grants.owner_user_id
       FROM (
         SELECT w.owner_user_id AS owner_user_id
           FROM service_account_workspace_grants g
           JOIN workspaces w ON w.id = g.workspace_id
          WHERE g.service_account_id = service_accounts.id
            AND w.owner_user_id IS NOT NULL
          GROUP BY w.owner_user_id
         HAVING COUNT(DISTINCT w.owner_user_id) = 1
       ) grants
      LIMIT 1
   )
 WHERE created_by_user_id IS NULL
   AND EXISTS (
     SELECT 1
       FROM service_account_workspace_grants g
       JOIN workspaces w ON w.id = g.workspace_id
      WHERE g.service_account_id = service_accounts.id
        AND w.owner_user_id IS NOT NULL
      GROUP BY g.service_account_id
     HAVING COUNT(DISTINCT w.owner_user_id) = 1
   );
