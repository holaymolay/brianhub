CREATE TABLE IF NOT EXISTS shopping_lists (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_lists_workspace ON shopping_lists(workspace_id);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_checked INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_shopping_items_checked ON shopping_list_items(is_checked);
