ALTER TABLE shopping_lists ADD COLUMN scheduled_for TEXT;
ALTER TABLE shopping_lists ADD COLUMN store_name TEXT;

CREATE INDEX IF NOT EXISTS idx_shopping_lists_workspace_scheduled
  ON shopping_lists(workspace_id, scheduled_for);
