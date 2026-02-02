CREATE TABLE IF NOT EXISTS task_types (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, name),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_task_types_workspace ON task_types(workspace_id);

INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at)
SELECT lower(hex(randomblob(16))), t.workspace_id, t.type_label, 0, 0, datetime('now'), datetime('now')
FROM tasks t
WHERE t.type_label IS NOT NULL
  AND trim(t.type_label) != ''
  AND NOT EXISTS (
    SELECT 1 FROM task_types tt
    WHERE tt.workspace_id = t.workspace_id AND tt.name = t.type_label
  );

INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'General', 1, 0, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM task_types tt
  WHERE tt.workspace_id = w.id AND tt.name = 'General'
);

INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'Bill Due', 1, 0, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM task_types tt
  WHERE tt.workspace_id = w.id AND tt.name = 'Bill Due'
);
