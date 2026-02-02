CREATE TABLE IF NOT EXISTS workspace_statuses (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  sort_order INTEGER NOT NULL DEFAULT 0,
  kanban_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, key),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_statuses_workspace ON workspace_statuses(workspace_id);

INSERT INTO workspace_statuses (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'inbox', 'Inbox', 'inbox', 10, 1, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_statuses ws
  WHERE ws.workspace_id = w.id AND ws.key = 'inbox'
);

INSERT INTO workspace_statuses (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'planned', 'Planned', 'planned', 20, 1, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_statuses ws
  WHERE ws.workspace_id = w.id AND ws.key = 'planned'
);

INSERT INTO workspace_statuses (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'in-progress', 'In Progress', 'in-progress', 30, 1, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_statuses ws
  WHERE ws.workspace_id = w.id AND ws.key = 'in-progress'
);

INSERT INTO workspace_statuses (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'waiting', 'Waiting', 'waiting', 40, 1, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_statuses ws
  WHERE ws.workspace_id = w.id AND ws.key = 'waiting'
);

INSERT INTO workspace_statuses (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'blocked', 'Blocked', 'blocked', 50, 1, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_statuses ws
  WHERE ws.workspace_id = w.id AND ws.key = 'blocked'
);

INSERT INTO workspace_statuses (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'done', 'Done', 'done', 60, 1, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_statuses ws
  WHERE ws.workspace_id = w.id AND ws.key = 'done'
);

INSERT INTO workspace_statuses (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
SELECT lower(hex(randomblob(16))), w.id, 'canceled', 'Canceled', 'canceled', 70, 1, datetime('now'), datetime('now')
FROM workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_statuses ws
  WHERE ws.workspace_id = w.id AND ws.key = 'canceled'
);
