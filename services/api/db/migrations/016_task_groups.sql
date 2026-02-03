PRAGMA foreign_keys = ON;

ALTER TABLE tasks ADD COLUMN group_label TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_group ON tasks(workspace_id, group_label);
