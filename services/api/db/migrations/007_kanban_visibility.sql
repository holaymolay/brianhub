UPDATE workspace_statuses
SET kanban_visible = 0,
    updated_at = datetime('now')
WHERE kind != 'custom';
