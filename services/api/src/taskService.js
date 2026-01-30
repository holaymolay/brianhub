import { randomUUID } from 'node:crypto';
import { applyCheckIn, applyWaitingFollowup, TaskStatus, transitionStatus } from '../../../packages/core/taskState.js';
import { compareTasksByPriority } from '../../../packages/core/priority.js';
import { buildAdjacency } from '../../../packages/core/tree.js';

const DEFAULT_WAITING_DAYS = 3;

function nowIso() {
  return new Date().toISOString();
}

function normalizeTemplateRow(row) {
  if (!row) return row;
  const { steps_json, ...rest } = row;
  let steps = [];
  if (steps_json) {
    try {
      steps = JSON.parse(steps_json);
    } catch {
      steps = [];
    }
  }
  return { ...rest, steps };
}

export function recordChange(db, workspaceId, entityType, entityId, action, payload, clientId = null) {
  db.prepare(
    'INSERT INTO change_log (workspace_id, entity_type, entity_id, action, payload, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(workspaceId, entityType, entityId, action, JSON.stringify(payload ?? {}), clientId, nowIso());
}

export function getWorkspace(db, id) {
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
}

export function createWorkspace(db, { name, type }) {
  const id = randomUUID();
  const timestamp = nowIso();
  db.prepare(
    'INSERT INTO workspaces (id, name, type, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, name, type, 0, timestamp, timestamp);
  return getWorkspace(db, id);
}

export function listWorkspaces(db) {
  return db.prepare('SELECT * FROM workspaces').all();
}

export function updateWorkspace(db, id, patch, clientId = null) {
  const existing = getWorkspace(db, id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    type: patch.type ?? existing.type,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  db.prepare('UPDATE workspaces SET name = ?, type = ?, archived = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.type, next.archived, next.updated_at, id);
  recordChange(db, id, 'workspace', id, 'update', patch, clientId);
  return getWorkspace(db, id);
}

export function deleteWorkspace(db, id, clientId = null) {
  const existing = getWorkspace(db, id);
  if (!existing) return { deleted: 0 };
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  recordChange(db, id, 'workspace', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function getProject(db, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

export function listProjects(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM projects WHERE workspace_id = ?').all(workspaceId);
}

export function createProject(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const project = {
    id,
    workspace_id: data.workspace_id,
    name: data.name,
    kind: data.kind ?? 'project',
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    'INSERT INTO projects (id, workspace_id, name, kind, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(project.id, project.workspace_id, project.name, project.kind, project.archived, project.created_at, project.updated_at);
  recordChange(db, project.workspace_id, 'project', id, 'create', project, clientId);
  return getProject(db, id);
}

export function updateProject(db, id, patch, clientId = null) {
  const existing = getProject(db, id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    kind: patch.kind ?? existing.kind,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  db.prepare('UPDATE projects SET name = ?, kind = ?, archived = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.kind, next.archived, next.updated_at, id);
  recordChange(db, existing.workspace_id, 'project', id, 'update', patch, clientId);
  return getProject(db, id);
}

export function deleteProject(db, id, clientId = null) {
  const existing = getProject(db, id);
  if (!existing) return { deleted: 0 };
  const tx = db.transaction(() => {
    db.prepare('UPDATE tasks SET project_id = NULL WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });
  tx();
  recordChange(db, existing.workspace_id, 'project', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function getTemplate(db, id) {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  return normalizeTemplateRow(row);
}

export function listTemplates(db, workspaceId) {
  if (!workspaceId) return [];
  const rows = db.prepare('SELECT * FROM templates WHERE workspace_id = ?').all(workspaceId);
  return rows.map(normalizeTemplateRow);
}

export function createTemplate(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const template = {
    id,
    workspace_id: data.workspace_id,
    project_id: data.project_id ?? null,
    name: data.name,
    steps_json: JSON.stringify(data.steps ?? []),
    lead_days: data.lead_days ?? 0,
    next_event_date: data.next_event_date ?? null,
    recurrence_interval: data.recurrence_interval ?? null,
    recurrence_unit: data.recurrence_unit ?? null,
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    `INSERT INTO templates (
      id, workspace_id, project_id, name, steps_json, lead_days, next_event_date,
      recurrence_interval, recurrence_unit, archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    template.id,
    template.workspace_id,
    template.project_id,
    template.name,
    template.steps_json,
    template.lead_days,
    template.next_event_date,
    template.recurrence_interval,
    template.recurrence_unit,
    template.archived,
    template.created_at,
    template.updated_at
  );
  recordChange(db, template.workspace_id, 'template', id, 'create', template, clientId);
  return getTemplate(db, id);
}

export function updateTemplate(db, id, patch, clientId = null) {
  const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    project_id: patch.project_id !== undefined ? (patch.project_id || null) : existing.project_id,
    steps_json: patch.steps ? JSON.stringify(patch.steps) : existing.steps_json,
    lead_days: patch.lead_days ?? existing.lead_days,
    next_event_date: patch.next_event_date !== undefined ? patch.next_event_date : existing.next_event_date,
    recurrence_interval: 'recurrence_interval' in patch ? patch.recurrence_interval : existing.recurrence_interval,
    recurrence_unit: 'recurrence_unit' in patch ? patch.recurrence_unit : existing.recurrence_unit,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  db.prepare(
    `UPDATE templates SET
      name = ?, project_id = ?, steps_json = ?, lead_days = ?, next_event_date = ?,
      recurrence_interval = ?, recurrence_unit = ?, archived = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.project_id,
    next.steps_json,
    next.lead_days,
    next.next_event_date,
    next.recurrence_interval,
    next.recurrence_unit,
    next.archived,
    next.updated_at,
    id
  );
  recordChange(db, existing.workspace_id, 'template', id, 'update', patch, clientId);
  return getTemplate(db, id);
}

export function deleteTemplate(db, id, clientId = null) {
  const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  if (!existing) return { deleted: 0 };
  const tx = db.transaction(() => {
    db.prepare('UPDATE tasks SET template_id = NULL WHERE template_id = ?').run(id);
    db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  });
  tx();
  recordChange(db, existing.workspace_id, 'template', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function createTask(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const status = data.status ?? TaskStatus.INBOX;
  const priority = data.priority ?? 'medium';
  const urgency = data.urgency ? 1 : 0;

  const task = {
    id,
    workspace_id: data.workspace_id,
    parent_id: data.parent_id ?? null,
    project_id: data.project_id ?? null,
    title: data.title,
    description_md: data.description_md ?? '',
    type_label: data.type_label ?? null,
    recurrence_interval: data.recurrence_interval ?? null,
    recurrence_unit: data.recurrence_unit ?? null,
    reminder_offset_days: data.reminder_offset_days ?? null,
    auto_debit: data.auto_debit ? 1 : 0,
    reminder_sent_at: data.reminder_sent_at ?? null,
    recurrence_parent_id: data.recurrence_parent_id ?? null,
    recurrence_generated_at: data.recurrence_generated_at ?? null,
    template_id: data.template_id ?? null,
    template_state: data.template_state ?? null,
    template_event_date: data.template_event_date ?? null,
    template_lead_days: data.template_lead_days ?? null,
    template_defer_until: data.template_defer_until ?? null,
    template_prompt_pending: data.template_prompt_pending ? 1 : 0,
    status,
    priority,
    urgency,
    start_at: data.start_at ?? null,
    due_at: data.due_at ?? null,
    completed_at: null,
    waiting_followup_at: data.waiting_followup_at ?? null,
    next_checkin_at: data.next_checkin_at ?? null,
    sort_order: data.sort_order ?? 0,
    task_type: data.task_type ?? 'task',
    created_at: timestamp,
    updated_at: timestamp
  };

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks (
        id, workspace_id, parent_id, project_id, title, description_md, status, priority, urgency,
        type_label, recurrence_interval, recurrence_unit, reminder_offset_days, auto_debit, reminder_sent_at,
        recurrence_parent_id, recurrence_generated_at,
        template_id, template_state, template_event_date, template_lead_days, template_defer_until, template_prompt_pending,
        start_at, due_at, completed_at, waiting_followup_at, next_checkin_at, sort_order, task_type,
        created_at, updated_at
      ) VALUES (
        @id, @workspace_id, @parent_id, @project_id, @title, @description_md, @status, @priority, @urgency,
        @type_label, @recurrence_interval, @recurrence_unit, @reminder_offset_days, @auto_debit, @reminder_sent_at,
        @recurrence_parent_id, @recurrence_generated_at,
        @template_id, @template_state, @template_event_date, @template_lead_days, @template_defer_until, @template_prompt_pending,
        @start_at, @due_at, @completed_at, @waiting_followup_at, @next_checkin_at, @sort_order, @task_type,
        @created_at, @updated_at
      )`
    ).run(task);

    // closure table inserts
    db.prepare('INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, 0)')
      .run(id, id);

    if (task.parent_id) {
      const ancestors = db.prepare('SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ?').all(task.parent_id);
      const insertEdge = db.prepare('INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)');
      for (const ancestor of ancestors) {
        insertEdge.run(ancestor.ancestor_id, id, ancestor.depth + 1);
      }
    }

    recordChange(db, task.workspace_id, 'task', id, 'create', task, clientId);
  });
  tx();

  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

export function getTask(db, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

export function updateTask(db, id, patch, clientId = null) {
  const existing = getTask(db, id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updated_at: nowIso() };
  if ('urgency' in patch) next.urgency = patch.urgency ? 1 : 0;
  if ('auto_debit' in patch) next.auto_debit = patch.auto_debit ? 1 : 0;
  if ('template_prompt_pending' in patch) next.template_prompt_pending = patch.template_prompt_pending ? 1 : 0;

  if (patch.status && patch.status !== existing.status) {
    transitionStatus(existing, patch.status);
    if (patch.status === TaskStatus.WAITING) {
      const waitingTask = applyWaitingFollowup({ ...next, status: TaskStatus.WAITING }, new Date(), DEFAULT_WAITING_DAYS);
      next.next_checkin_at = waitingTask.next_checkin_at;
    }
    if (patch.status === TaskStatus.DONE) {
      next.completed_at = next.completed_at ?? nowIso();
    }
  }

  const fields = [
    'title', 'description_md', 'type_label', 'recurrence_interval', 'recurrence_unit', 'reminder_offset_days',
    'auto_debit', 'reminder_sent_at', 'recurrence_parent_id', 'recurrence_generated_at',
    'template_id', 'template_state', 'template_event_date', 'template_lead_days', 'template_defer_until', 'template_prompt_pending',
    'status', 'priority', 'urgency', 'start_at', 'due_at', 'completed_at',
    'waiting_followup_at', 'next_checkin_at', 'sort_order', 'task_type', 'project_id'
  ];
  const updates = fields.map(field => `${field} = @${field}`).join(', ');

  db.prepare(`UPDATE tasks SET ${updates}, updated_at = @updated_at WHERE id = @id`).run(next);
  recordChange(db, next.workspace_id, 'task', id, 'update', patch, clientId);
  return getTask(db, id);
}

export function deleteTask(db, id, clientId = null) {
  const existing = getTask(db, id);
  if (!existing) return { deleted: 0 };
  const descendants = db.prepare('SELECT descendant_id FROM task_edges WHERE ancestor_id = ?').all(id);
  const ids = descendants.map(row => row.descendant_id);
  if (ids.length === 0) return { deleted: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM tasks WHERE id IN (${placeholders})`).run(...ids);
  });
  tx();

  recordChange(db, existing.workspace_id, 'task', id, 'delete', { ids }, clientId);
  return { deleted: ids.length, ids };
}

export function listTasks(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM tasks WHERE workspace_id = ?').all(workspaceId);
}

export function getTaskTree(db, workspaceId, rootId = null) {
  let tasks;
  if (rootId) {
    const descendants = db.prepare('SELECT descendant_id FROM task_edges WHERE ancestor_id = ?').all(rootId);
    const ids = descendants.map(row => row.descendant_id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    tasks = db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...ids);
  } else {
    tasks = listTasks(db, workspaceId);
  }

  const tree = buildAdjacency(tasks);
  tree.forEach(sortTreeByPriority);
  return tree;
}

function sortTreeByPriority(node) {
  node.children.sort(compareTasksByPriority);
  node.children.forEach(sortTreeByPriority);
}

export function reparentTask(db, taskId, newParentId, clientId = null) {
  if (taskId === newParentId) throw new Error('Cannot reparent task under itself');

  if (newParentId) {
    const cycle = db.prepare('SELECT 1 FROM task_edges WHERE ancestor_id = ? AND descendant_id = ? LIMIT 1')
      .get(taskId, newParentId);
    if (cycle) throw new Error('Cannot reparent task under its descendant');
  }

  const descendants = db.prepare('SELECT descendant_id, depth FROM task_edges WHERE ancestor_id = ?').all(taskId);
  const ancestorRows = db.prepare('SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ? AND depth > 0').all(taskId);

  const tx = db.transaction(() => {
    if (ancestorRows.length && descendants.length) {
      const ancestorIds = ancestorRows.map(row => row.ancestor_id);
      const descendantIds = descendants.map(row => row.descendant_id);
      const ancestorPlaceholders = ancestorIds.map(() => '?').join(',');
      const descendantPlaceholders = descendantIds.map(() => '?').join(',');
      db.prepare(
        `DELETE FROM task_edges WHERE ancestor_id IN (${ancestorPlaceholders}) AND descendant_id IN (${descendantPlaceholders})`
      ).run(...ancestorIds, ...descendantIds);
    }

    if (newParentId) {
      const newAncestors = db.prepare('SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ?').all(newParentId);
      const insertEdge = db.prepare('INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)');
      for (const ancestor of newAncestors) {
        for (const descendant of descendants) {
          insertEdge.run(ancestor.ancestor_id, descendant.descendant_id, ancestor.depth + 1 + descendant.depth);
        }
      }
    }

    db.prepare('UPDATE tasks SET parent_id = ?, updated_at = ? WHERE id = ?')
      .run(newParentId ?? null, nowIso(), taskId);
  });
  tx();

  const updated = getTask(db, taskId);
  recordChange(db, updated.workspace_id, 'task', taskId, 'reparent', { new_parent_id: newParentId }, clientId);
  return updated;
}

export function applyTaskCheckIn(db, taskId, response, clientId = null) {
  const task = getTask(db, taskId);
  if (!task) return null;
  if (response === 'no') {
    rescheduleSubtree(db, taskId, 24 * 60 * 60 * 1000, clientId);
  }
  const updated = applyCheckIn(task, response, new Date());

  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE tasks SET status = ?, completed_at = ?, next_checkin_at = ?, updated_at = ? WHERE id = ?'
    ).run(updated.status, updated.completed_at, updated.next_checkin_at, nowIso(), taskId);

    const checkinId = randomUUID();
    db.prepare(
      'INSERT INTO task_checkins (id, task_id, scheduled_at, response, responded_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      checkinId,
      taskId,
      task.next_checkin_at ?? nowIso(),
      response,
      nowIso(),
      nowIso()
    );
  });
  tx();

  recordChange(db, task.workspace_id, 'task', taskId, 'checkin', { response }, clientId);
  return getTask(db, taskId);
}

export function rescheduleSubtree(db, taskId, deltaMs, clientId = null) {
  const descendants = db.prepare('SELECT descendant_id FROM task_edges WHERE ancestor_id = ?').all(taskId);
  const ids = descendants.map(row => row.descendant_id);
  if (ids.length === 0) return { updated: 0 };

  const tasks = db.prepare(`SELECT id, start_at, due_at, next_checkin_at, workspace_id FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const tx = db.transaction(() => {
    const update = db.prepare('UPDATE tasks SET start_at = ?, due_at = ?, next_checkin_at = ?, updated_at = ? WHERE id = ?');
    for (const task of tasks) {
      const startAt = task.start_at ? new Date(task.start_at).getTime() + deltaMs : null;
      const dueAt = task.due_at ? new Date(task.due_at).getTime() + deltaMs : null;
      const nextCheck = task.next_checkin_at ? new Date(task.next_checkin_at).getTime() + deltaMs : null;
      update.run(
        startAt ? new Date(startAt).toISOString() : null,
        dueAt ? new Date(dueAt).toISOString() : null,
        nextCheck ? new Date(nextCheck).toISOString() : null,
        nowIso(),
        task.id
      );
    }
  });
  tx();

  if (tasks[0]) {
    recordChange(db, tasks[0].workspace_id, 'task', taskId, 'reschedule', { deltaMs }, clientId);
  }
  return { updated: tasks.length };
}

export function searchTasks(db, workspaceId, { text, status, tag }) {
  const params = [workspaceId];
  let where = 'workspace_id = ?';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }
  if (text) {
    where += ' AND (title LIKE ? OR description_md LIKE ?)';
    const like = `%${text}%`;
    params.push(like, like);
  }
  if (tag) {
    where += ' AND id IN (SELECT task_id FROM task_tags tt JOIN tags t ON t.id = tt.tag_id WHERE t.name = ?)';
    params.push(tag);
  }
  return db.prepare(`SELECT * FROM tasks WHERE ${where}`).all(...params);
}
