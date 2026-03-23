ALTER TABLE shopping_list_items ADD COLUMN item_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE shopping_list_items ADD COLUMN substitute_name TEXT;

UPDATE shopping_list_items
SET item_state = CASE
  WHEN is_checked = 1 THEN 'bought'
  ELSE 'pending'
END
WHERE item_state IS NULL OR item_state = '';

CREATE TABLE IF NOT EXISTS shopping_item_order_hints (
  workspace_id TEXT NOT NULL,
  store_name_key TEXT NOT NULL,
  item_name_key TEXT NOT NULL,
  sort_rank INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, store_name_key, item_name_key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_item_order_hints_workspace_store
  ON shopping_item_order_hints(workspace_id, store_name_key, sort_rank);
