import { randomUUID } from 'node:crypto';
import { applyCheckIn, applyWaitingFollowup, TaskStatus } from '../../../packages/core/taskState.js';
import { compareTasksByPriority } from '../../../packages/core/priority.js';
import { buildAdjacency } from '../../../packages/core/tree.js';

const DEFAULT_WAITING_DAYS = 3;
const DEFAULT_STATUSES = [
  { key: TaskStatus.INBOX, label: 'Inbox', kind: TaskStatus.INBOX, sort_order: 10, kanban_visible: 0 },
  { key: TaskStatus.PLANNED, label: 'Planned', kind: TaskStatus.PLANNED, sort_order: 20, kanban_visible: 0 },
  { key: TaskStatus.IN_PROGRESS, label: 'In Progress', kind: TaskStatus.IN_PROGRESS, sort_order: 30, kanban_visible: 0 },
  { key: TaskStatus.WAITING, label: 'Waiting', kind: TaskStatus.WAITING, sort_order: 40, kanban_visible: 0 },
  { key: TaskStatus.BLOCKED, label: 'Blocked', kind: TaskStatus.BLOCKED, sort_order: 50, kanban_visible: 0 },
  { key: TaskStatus.DONE, label: 'Done', kind: TaskStatus.DONE, sort_order: 60, kanban_visible: 0 },
  { key: TaskStatus.CANCELED, label: 'Canceled', kind: TaskStatus.CANCELED, sort_order: 70, kanban_visible: 0 }
];

const DEFAULT_TASK_TYPES = [
  { name: 'General', is_default: 1 },
  { name: 'Bill Due', is_default: 1 }
];
const DEFAULT_NOTICE_TYPES = [
  { key: 'general', label: 'General' },
  { key: 'bill', label: 'Bill notice' },
  { key: 'auto-payment', label: 'Auto-payment notice' }
];

function nowIso() {
  return new Date().toISOString();
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  seedWorkspaceStatuses(db, id);
  seedWorkspaceTaskTypes(db, id);
  seedWorkspaceNoticeTypes(db, id);
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

export function getShoppingList(db, id) {
  return db.prepare('SELECT * FROM shopping_lists WHERE id = ?').get(id);
}

export function listShoppingLists(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM shopping_lists WHERE workspace_id = ?').all(workspaceId);
}

export function createShoppingList(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const list = {
    id,
    workspace_id: data.workspace_id,
    name: data.name,
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    'INSERT INTO shopping_lists (id, workspace_id, name, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(list.id, list.workspace_id, list.name, list.archived, list.created_at, list.updated_at);
  recordChange(db, list.workspace_id, 'shopping_list', id, 'create', list, clientId);
  return getShoppingList(db, id);
}

export function updateShoppingList(db, id, patch, clientId = null) {
  const existing = getShoppingList(db, id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  db.prepare('UPDATE shopping_lists SET name = ?, archived = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.archived, next.updated_at, id);
  recordChange(db, existing.workspace_id, 'shopping_list', id, 'update', patch, clientId);
  return getShoppingList(db, id);
}

export function deleteShoppingList(db, id, clientId = null) {
  const existing = getShoppingList(db, id);
  if (!existing) return { deleted: 0 };
  db.prepare('DELETE FROM shopping_lists WHERE id = ?').run(id);
  recordChange(db, existing.workspace_id, 'shopping_list', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function getShoppingItem(db, id) {
  return db.prepare('SELECT * FROM shopping_list_items WHERE id = ?').get(id);
}

export function listShoppingItems(db, workspaceId, listId = null) {
  if (listId) {
    return db.prepare(
      'SELECT * FROM shopping_list_items WHERE list_id = ? ORDER BY sort_order ASC, created_at ASC'
    ).all(listId);
  }
  if (!workspaceId) return [];
  return db.prepare(
    `SELECT items.* FROM shopping_list_items items
     JOIN shopping_lists lists ON lists.id = items.list_id
     WHERE lists.workspace_id = ?
     ORDER BY items.sort_order ASC, items.created_at ASC`
  ).all(workspaceId);
}

export function createShoppingItems(db, listId, items, clientId = null) {
  const list = getShoppingList(db, listId);
  if (!list) return [];
  const timestamp = nowIso();
  const maxRow = db.prepare('SELECT MAX(sort_order) AS max_sort FROM shopping_list_items WHERE list_id = ?')
    .get(listId);
  let sortOrder = Number(maxRow?.max_sort ?? 0);
  const created = [];
  const tx = db.transaction(() => {
    for (const item of items) {
      const id = randomUUID();
      sortOrder += 1;
      const record = {
        id,
        list_id: listId,
        name: item.name ?? item,
        is_checked: item.is_checked ? 1 : 0,
        sort_order: Number.isFinite(item.sort_order) ? item.sort_order : sortOrder,
        created_at: timestamp,
        updated_at: timestamp
      };
      db.prepare(
        'INSERT INTO shopping_list_items (id, list_id, name, is_checked, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        record.id,
        record.list_id,
        record.name,
        record.is_checked,
        record.sort_order,
        record.created_at,
        record.updated_at
      );
      recordChange(db, list.workspace_id, 'shopping_item', record.id, 'create', record, clientId);
      created.push(record);
    }
  });
  tx();
  return created.map(item => getShoppingItem(db, item.id));
}

export function createShoppingItem(db, data, clientId = null) {
  const list = getShoppingList(db, data.list_id);
  if (!list) return null;
  const timestamp = nowIso();
  const maxRow = db.prepare('SELECT MAX(sort_order) AS max_sort FROM shopping_list_items WHERE list_id = ?')
    .get(data.list_id);
  const nextSort = Number(maxRow?.max_sort ?? 0) + 1;
  const item = {
    id: randomUUID(),
    list_id: data.list_id,
    name: data.name,
    is_checked: data.is_checked ? 1 : 0,
    sort_order: Number.isFinite(data.sort_order) ? data.sort_order : nextSort,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    'INSERT INTO shopping_list_items (id, list_id, name, is_checked, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    item.id,
    item.list_id,
    item.name,
    item.is_checked,
    item.sort_order,
    item.created_at,
    item.updated_at
  );
  recordChange(db, list.workspace_id, 'shopping_item', item.id, 'create', item, clientId);
  return getShoppingItem(db, item.id);
}

export function updateShoppingItem(db, id, patch, clientId = null) {
  const existing = getShoppingItem(db, id);
  if (!existing) return null;
  const list = getShoppingList(db, existing.list_id);
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    is_checked: patch.is_checked !== undefined ? (patch.is_checked ? 1 : 0) : existing.is_checked ?? 0,
    sort_order: Number.isFinite(patch.sort_order) ? patch.sort_order : existing.sort_order,
    updated_at: nowIso()
  };
  db.prepare('UPDATE shopping_list_items SET name = ?, is_checked = ?, sort_order = ?, updated_at = ? WHERE id = ?')
    .run(next.name, next.is_checked, next.sort_order, next.updated_at, id);
  if (list) {
    recordChange(db, list.workspace_id, 'shopping_item', id, 'update', patch, clientId);
  }
  return getShoppingItem(db, id);
}

export function deleteShoppingItem(db, id, clientId = null) {
  const existing = getShoppingItem(db, id);
  if (!existing) return { deleted: 0 };
  const list = getShoppingList(db, existing.list_id);
  db.prepare('DELETE FROM shopping_list_items WHERE id = ?').run(id);
  if (list) {
    recordChange(db, list.workspace_id, 'shopping_item', id, 'delete', {}, clientId);
  }
  return { deleted: 1 };
}

export function listNotices(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM notices WHERE workspace_id = ? ORDER BY notify_at ASC')
    .all(workspaceId);
}

function getNotice(db, id) {
  return db.prepare('SELECT * FROM notices WHERE id = ?').get(id);
}

export function createNotice(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const title = (data.title ?? '').trim();
  const notifyAt = data.notify_at ?? null;
  if (!title || !notifyAt) {
    throw new Error('Invalid notice');
  }
  const notice = {
    id,
    workspace_id: data.workspace_id,
    title,
    notify_at: notifyAt,
    notice_type: data.notice_type ?? 'general',
    notice_sent_at: data.notice_sent_at ?? null,
    dismissed_at: data.dismissed_at ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    'INSERT INTO notices (id, workspace_id, title, notify_at, notice_type, notice_sent_at, dismissed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    notice.id,
    notice.workspace_id,
    notice.title,
    notice.notify_at,
    notice.notice_type,
    notice.notice_sent_at,
    notice.dismissed_at,
    notice.created_at,
    notice.updated_at
  );
  recordChange(db, notice.workspace_id, 'notice', id, 'create', notice, clientId);
  return getNotice(db, id);
}

export function updateNotice(db, id, patch, clientId = null) {
  const existing = getNotice(db, id);
  if (!existing) return null;
  const next = {
    ...existing,
    title: patch.title !== undefined ? String(patch.title).trim() : existing.title,
    notify_at: patch.notify_at ?? existing.notify_at,
    notice_type: patch.notice_type ?? existing.notice_type ?? 'general',
    notice_sent_at: patch.notice_sent_at ?? existing.notice_sent_at,
    dismissed_at: patch.dismissed_at ?? existing.dismissed_at,
    updated_at: nowIso()
  };
  db.prepare(
    'UPDATE notices SET title = ?, notify_at = ?, notice_type = ?, notice_sent_at = ?, dismissed_at = ?, updated_at = ? WHERE id = ?'
  ).run(
    next.title,
    next.notify_at,
    next.notice_type,
    next.notice_sent_at,
    next.dismissed_at,
    next.updated_at,
    id
  );
  recordChange(db, existing.workspace_id, 'notice', id, 'update', patch, clientId);
  return getNotice(db, id);
}

export function deleteNotice(db, id, clientId = null) {
  const existing = getNotice(db, id);
  if (!existing) return { deleted: 0 };
  db.prepare('DELETE FROM notices WHERE id = ?').run(id);
  recordChange(db, existing.workspace_id, 'notice', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function listNoticeTypes(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM notice_types WHERE workspace_id = ? ORDER BY label ASC')
    .all(workspaceId);
}

function getNoticeType(db, id) {
  return db.prepare('SELECT * FROM notice_types WHERE id = ?').get(id);
}

function getNoticeTypeByKey(db, workspaceId, key) {
  return db.prepare('SELECT * FROM notice_types WHERE workspace_id = ? AND key = ?')
    .get(workspaceId, key);
}

function getNoticeTypeByLabel(db, workspaceId, label) {
  return db.prepare('SELECT * FROM notice_types WHERE workspace_id = ? AND label = ?')
    .get(workspaceId, label);
}

function generateNoticeTypeKey(db, workspaceId, label) {
  const base = slugify(label || 'type');
  let key = base || 'type';
  let suffix = 1;
  while (getNoticeTypeByKey(db, workspaceId, key)) {
    suffix += 1;
    key = `${base}-${suffix}`;
  }
  return key;
}

export function createNoticeType(db, data, clientId = null) {
  const label = String(data.label ?? '').trim();
  if (!label) throw new Error('Label required');
  const existing = getNoticeTypeByLabel(db, data.workspace_id, label);
  if (existing) return existing;
  const id = randomUUID();
  const timestamp = nowIso();
  const key = generateNoticeTypeKey(db, data.workspace_id, label);
  db.prepare(
    'INSERT INTO notice_types (id, workspace_id, key, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, data.workspace_id, key, label, timestamp, timestamp);
  recordChange(db, data.workspace_id, 'notice_type', id, 'create', { key, label }, clientId);
  return getNoticeType(db, id);
}

export function updateNoticeType(db, id, patch, clientId = null) {
  const existing = getNoticeType(db, id);
  if (!existing) return null;
  const nextLabel = patch.label !== undefined ? String(patch.label).trim() : existing.label;
  const next = {
    ...existing,
    label: nextLabel || existing.label,
    updated_at: nowIso()
  };
  db.prepare('UPDATE notice_types SET label = ?, updated_at = ? WHERE id = ?')
    .run(next.label, next.updated_at, id);
  recordChange(db, existing.workspace_id, 'notice_type', id, 'update', patch, clientId);
  return getNoticeType(db, id);
}

export function deleteNoticeType(db, id, clientId = null) {
  const existing = getNoticeType(db, id);
  if (!existing) return { deleted: 0 };
  db.prepare('DELETE FROM notice_types WHERE id = ?').run(id);
  recordChange(db, existing.workspace_id, 'notice_type', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function listStoreRules(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM store_rules WHERE workspace_id = ? ORDER BY store_name ASC').all(workspaceId);
}

function getStoreRule(db, id) {
  return db.prepare('SELECT * FROM store_rules WHERE id = ?').get(id);
}

export function createStoreRule(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const keywords = Array.isArray(data.keywords) ? data.keywords : [];
  const rule = {
    id,
    workspace_id: data.workspace_id,
    store_name: data.store_name,
    keywords_json: JSON.stringify(keywords),
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    'INSERT INTO store_rules (id, workspace_id, store_name, keywords_json, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    rule.id,
    rule.workspace_id,
    rule.store_name,
    rule.keywords_json,
    rule.archived,
    rule.created_at,
    rule.updated_at
  );
  recordChange(db, rule.workspace_id, 'store_rule', id, 'create', rule, clientId);
  return getStoreRule(db, id);
}

export function updateStoreRule(db, id, patch, clientId = null) {
  const existing = getStoreRule(db, id);
  if (!existing) return null;
  const nextKeywords = Array.isArray(patch.keywords)
    ? JSON.stringify(patch.keywords)
    : existing.keywords_json;
  const next = {
    ...existing,
    store_name: patch.store_name ?? existing.store_name,
    keywords_json: nextKeywords,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  db.prepare(
    'UPDATE store_rules SET store_name = ?, keywords_json = ?, archived = ?, updated_at = ? WHERE id = ?'
  ).run(
    next.store_name,
    next.keywords_json,
    next.archived,
    next.updated_at,
    id
  );
  recordChange(db, existing.workspace_id, 'store_rule', id, 'update', patch, clientId);
  return getStoreRule(db, id);
}

export function deleteStoreRule(db, id, clientId = null) {
  const existing = getStoreRule(db, id);
  if (!existing) return { deleted: 0 };
  db.prepare('DELETE FROM store_rules WHERE id = ?').run(id);
  recordChange(db, existing.workspace_id, 'store_rule', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function listTaskTypes(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM task_types WHERE workspace_id = ? ORDER BY is_default DESC, name ASC')
    .all(workspaceId);
}

function getTaskType(db, id) {
  return db.prepare('SELECT * FROM task_types WHERE id = ?').get(id);
}

function getTaskTypeByName(db, workspaceId, name) {
  if (!workspaceId || !name) return null;
  return db.prepare('SELECT * FROM task_types WHERE workspace_id = ? AND name = ?')
    .get(workspaceId, name);
}

function getDefaultTaskType(db, workspaceId) {
  if (!workspaceId) return null;
  return db.prepare('SELECT * FROM task_types WHERE workspace_id = ? AND is_default = 1 ORDER BY name ASC LIMIT 1')
    .get(workspaceId);
}

export function createTaskType(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const name = (data.name ?? '').trim();
  if (!name) throw new Error('Invalid task type name');
  if (getTaskTypeByName(db, data.workspace_id, name)) {
    throw new Error('Task type already exists');
  }
  const type = {
    id,
    workspace_id: data.workspace_id,
    name,
    is_default: data.is_default ? 1 : 0,
    archived: data.archived ? 1 : 0,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    'INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(type.id, type.workspace_id, type.name, type.is_default, type.archived, type.created_at, type.updated_at);
  recordChange(db, type.workspace_id, 'task_type', id, 'create', type, clientId);
  return getTaskType(db, id);
}

export function updateTaskType(db, id, patch, clientId = null) {
  const existing = getTaskType(db, id);
  if (!existing) return null;
  const nextName = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!nextName) throw new Error('Invalid task type name');
  if (nextName !== existing.name && getTaskTypeByName(db, existing.workspace_id, nextName)) {
    throw new Error('Task type already exists');
  }
  const next = {
    ...existing,
    name: nextName,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived,
    updated_at: nowIso()
  };
  const tx = db.transaction(() => {
    db.prepare('UPDATE task_types SET name = ?, archived = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.archived, next.updated_at, id);
    if (next.name !== existing.name) {
      db.prepare('UPDATE tasks SET type_label = ?, updated_at = ? WHERE workspace_id = ? AND type_label = ?')
        .run(next.name, next.updated_at, existing.workspace_id, existing.name);
    }
  });
  tx();
  recordChange(db, existing.workspace_id, 'task_type', id, 'update', patch, clientId);
  return getTaskType(db, id);
}

export function deleteTaskType(db, id, clientId = null) {
  const existing = getTaskType(db, id);
  if (!existing) return { deleted: 0 };
  if (existing.is_default) {
    return { deleted: 0, error: 'protected' };
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE tasks SET type_label = NULL, updated_at = ? WHERE workspace_id = ? AND type_label = ?')
      .run(nowIso(), existing.workspace_id, existing.name);
    db.prepare('DELETE FROM task_types WHERE id = ?').run(id);
  });
  tx();
  recordChange(db, existing.workspace_id, 'task_type', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function listStatuses(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM workspace_statuses WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(workspaceId);
}

export function getStatusByKey(db, workspaceId, key) {
  if (!workspaceId || !key) return null;
  return db.prepare('SELECT * FROM workspace_statuses WHERE workspace_id = ? AND key = ?')
    .get(workspaceId, key);
}

function getFallbackStatus(db, workspaceId) {
  if (!workspaceId) return null;
  const inbox = db.prepare('SELECT * FROM workspace_statuses WHERE workspace_id = ? AND kind = ?')
    .get(workspaceId, TaskStatus.INBOX);
  if (inbox) return inbox;
  return db.prepare('SELECT * FROM workspace_statuses WHERE workspace_id = ? ORDER BY sort_order ASC LIMIT 1')
    .get(workspaceId);
}

function ensureStatusKeyUnique(db, workspaceId, baseKey) {
  let key = baseKey;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM workspace_statuses WHERE workspace_id = ? AND key = ?').get(workspaceId, key)) {
    key = `${baseKey}-${suffix}`;
    suffix += 1;
  }
  return key;
}

export function createStatus(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const label = (data.label ?? '').trim();
  const keyBase = data.key ? slugify(data.key) : slugify(label);
  if (!keyBase) throw new Error('Invalid status key');
  const key = ensureStatusKeyUnique(db, data.workspace_id, keyBase);
  const maxRow = db.prepare('SELECT MAX(sort_order) AS max_sort FROM workspace_statuses WHERE workspace_id = ?')
    .get(data.workspace_id);
  const nextSort = Number(maxRow?.max_sort ?? 0) + 10;
  const status = {
    id,
    workspace_id: data.workspace_id,
    key,
    label: label || key,
    kind: data.kind ?? 'custom',
    sort_order: Number.isFinite(data.sort_order) ? data.sort_order : nextSort,
    kanban_visible: data.kanban_visible !== undefined ? (data.kanban_visible ? 1 : 0) : 1,
    created_at: timestamp,
    updated_at: timestamp
  };
  db.prepare(
    `INSERT INTO workspace_statuses
      (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    status.id,
    status.workspace_id,
    status.key,
    status.label,
    status.kind,
    status.sort_order,
    status.kanban_visible,
    status.created_at,
    status.updated_at
  );
  recordChange(db, status.workspace_id, 'status', id, 'create', status, clientId);
  return getStatusByKey(db, status.workspace_id, status.key);
}

export function updateStatus(db, id, patch, clientId = null) {
  const existing = db.prepare('SELECT * FROM workspace_statuses WHERE id = ?').get(id);
  if (!existing) return null;
  const nextLabel = patch.label !== undefined ? String(patch.label).trim() : existing.label;
  const next = {
    ...existing,
    label: nextLabel || existing.label,
    sort_order: Number.isFinite(patch.sort_order) ? patch.sort_order : existing.sort_order,
    kanban_visible: patch.kanban_visible !== undefined ? (patch.kanban_visible ? 1 : 0) : existing.kanban_visible,
    updated_at: nowIso()
  };
  db.prepare(
    'UPDATE workspace_statuses SET label = ?, sort_order = ?, kanban_visible = ?, updated_at = ? WHERE id = ?'
  ).run(next.label, next.sort_order, next.kanban_visible, next.updated_at, id);
  recordChange(db, existing.workspace_id, 'status', id, 'update', patch, clientId);
  return db.prepare('SELECT * FROM workspace_statuses WHERE id = ?').get(id);
}

export function deleteStatus(db, id, clientId = null) {
  const existing = db.prepare('SELECT * FROM workspace_statuses WHERE id = ?').get(id);
  if (!existing) return { deleted: 0 };
  if (existing.kind !== 'custom') {
    return { deleted: 0, error: 'protected' };
  }
  const fallback = getFallbackStatus(db, existing.workspace_id);
  const fallbackKey = fallback?.key ?? TaskStatus.INBOX;
  const tx = db.transaction(() => {
    db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE workspace_id = ? AND status = ?')
      .run(fallbackKey, nowIso(), existing.workspace_id, existing.key);
    db.prepare('DELETE FROM workspace_statuses WHERE id = ?').run(id);
  });
  tx();
  recordChange(db, existing.workspace_id, 'status', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export function seedWorkspaceStatuses(db, workspaceId) {
  const timestamp = nowIso();
  const insert = db.prepare(
    `INSERT INTO workspace_statuses
      (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  DEFAULT_STATUSES.forEach(status => {
    const existing = getStatusByKey(db, workspaceId, status.key);
    if (existing) return;
    insert.run(
      randomUUID(),
      workspaceId,
      status.key,
      status.label,
      status.kind,
      status.sort_order,
      status.kanban_visible,
      timestamp,
      timestamp
    );
  });
}

export function seedWorkspaceTaskTypes(db, workspaceId) {
  const timestamp = nowIso();
  const insert = db.prepare(
    'INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  DEFAULT_TASK_TYPES.forEach(type => {
    const existing = getTaskTypeByName(db, workspaceId, type.name);
    if (existing) return;
    insert.run(
      randomUUID(),
      workspaceId,
      type.name,
      type.is_default ? 1 : 0,
      0,
      timestamp,
      timestamp
    );
  });
}

export function seedWorkspaceNoticeTypes(db, workspaceId) {
  const timestamp = nowIso();
  const insert = db.prepare(
    'INSERT INTO notice_types (id, workspace_id, key, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  DEFAULT_NOTICE_TYPES.forEach(type => {
    const existing = db.prepare('SELECT 1 FROM notice_types WHERE workspace_id = ? AND key = ?')
      .get(workspaceId, type.key);
    if (existing) return;
    insert.run(randomUUID(), workspaceId, type.key, type.label, timestamp, timestamp);
  });
}

export function createTask(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const fallbackStatus = getFallbackStatus(db, data.workspace_id);
  const statusKey = data.status ?? fallbackStatus?.key ?? TaskStatus.INBOX;
  const statusRow = getStatusByKey(db, data.workspace_id, statusKey);
  if (!statusRow) {
    throw new Error('Invalid status');
  }
  const status = statusRow.key;
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

  if (statusRow.kind === TaskStatus.WAITING && !task.next_checkin_at) {
    const waitingTask = applyWaitingFollowup({ ...task, status: TaskStatus.WAITING }, new Date(), DEFAULT_WAITING_DAYS);
    task.next_checkin_at = waitingTask.next_checkin_at;
  }
  if (statusRow.kind === TaskStatus.DONE && !task.completed_at) {
    task.completed_at = timestamp;
  }

  const tx = db.transaction(() => {
    const insertColumns = [
      'id',
      'workspace_id',
      'parent_id',
      'project_id',
      'title',
      'description_md',
      'status',
      'priority',
      'urgency',
      'type_label',
      'recurrence_interval',
      'recurrence_unit',
      'reminder_offset_days',
      'auto_debit',
      'reminder_sent_at',
      'recurrence_parent_id',
      'recurrence_generated_at',
      'template_id',
      'template_state',
      'template_event_date',
      'template_lead_days',
      'template_defer_until',
      'template_prompt_pending',
      'start_at',
      'due_at',
      'completed_at',
      'waiting_followup_at',
      'next_checkin_at',
      'sort_order',
      'task_type',
      'created_at',
      'updated_at'
    ];
    const insertValues = [
      task.id,
      task.workspace_id,
      task.parent_id,
      task.project_id,
      task.title,
      task.description_md,
      task.status,
      task.priority,
      task.urgency,
      task.type_label,
      task.recurrence_interval,
      task.recurrence_unit,
      task.reminder_offset_days,
      task.auto_debit,
      task.reminder_sent_at,
      task.recurrence_parent_id,
      task.recurrence_generated_at,
      task.template_id,
      task.template_state,
      task.template_event_date,
      task.template_lead_days,
      task.template_defer_until,
      task.template_prompt_pending,
      task.start_at,
      task.due_at,
      task.completed_at,
      task.waiting_followup_at,
      task.next_checkin_at,
      task.sort_order,
      task.task_type,
      task.created_at,
      task.updated_at
    ];
    const placeholders = insertColumns.map(() => '?').join(', ');
    db.prepare(`INSERT INTO tasks (${insertColumns.join(', ')}) VALUES (${placeholders})`).run(...insertValues);

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
    const statusRow = getStatusByKey(db, existing.workspace_id, patch.status);
    if (!statusRow) {
      throw new Error('Invalid status');
    }
    if (statusRow.kind === TaskStatus.WAITING) {
      const explicitFollowup = patch.next_checkin_at ?? patch.waiting_followup_at ?? null;
      if (explicitFollowup) {
        next.next_checkin_at = explicitFollowup;
      } else {
        const waitingTask = applyWaitingFollowup({ ...next, status: TaskStatus.WAITING }, new Date(), DEFAULT_WAITING_DAYS);
        next.next_checkin_at = waitingTask.next_checkin_at;
      }
    }
    if (statusRow.kind === TaskStatus.DONE) {
      next.completed_at = next.completed_at ?? nowIso();
    }
    if (statusRow.kind !== TaskStatus.DONE && !('completed_at' in patch)) {
      next.completed_at = null;
    }
  }

  const fields = [
    'title', 'description_md', 'type_label', 'recurrence_interval', 'recurrence_unit', 'reminder_offset_days',
    'auto_debit', 'reminder_sent_at', 'recurrence_parent_id', 'recurrence_generated_at',
    'template_id', 'template_state', 'template_event_date', 'template_lead_days', 'template_defer_until', 'template_prompt_pending',
    'status', 'priority', 'urgency', 'start_at', 'due_at', 'completed_at',
    'waiting_followup_at', 'next_checkin_at', 'sort_order', 'task_type', 'project_id'
  ];
  const values = fields.map(field => next[field]);
  db.prepare(`UPDATE tasks SET ${fields.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...values, next.updated_at, id);
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

export function listTaskDependencies(db, workspaceId) {
  if (!workspaceId) return [];
  return db.prepare('SELECT * FROM task_dependencies WHERE workspace_id = ?').all(workspaceId);
}

export function addTaskDependency(db, taskId, dependsOnId, clientId = null) {
  if (!taskId || !dependsOnId) throw new Error('Task ids required');
  if (taskId === dependsOnId) throw new Error('Task cannot depend on itself');
  const task = getTask(db, taskId);
  const dependency = getTask(db, dependsOnId);
  if (!task || !dependency) throw new Error('Task not found');
  if (task.workspace_id !== dependency.workspace_id) {
    throw new Error('Tasks must be in the same workspace');
  }
  const existing = db.prepare('SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?')
    .get(taskId, dependsOnId);
  if (existing) return { task_id: taskId, depends_on_id: dependsOnId, workspace_id: task.workspace_id };
  const created_at = nowIso();
  db.prepare(
    'INSERT INTO task_dependencies (task_id, depends_on_id, workspace_id, created_at) VALUES (?, ?, ?, ?)'
  ).run(taskId, dependsOnId, task.workspace_id, created_at);
  recordChange(
    db,
    task.workspace_id,
    'task_dependency',
    `${taskId}:${dependsOnId}`,
    'create',
    { task_id: taskId, depends_on_id: dependsOnId },
    clientId
  );
  return { task_id: taskId, depends_on_id: dependsOnId, workspace_id: task.workspace_id, created_at };
}

export function removeTaskDependency(db, taskId, dependsOnId, clientId = null) {
  if (!taskId || !dependsOnId) throw new Error('Task ids required');
  const task = getTask(db, taskId);
  if (!task) throw new Error('Task not found');
  const result = db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?')
    .run(taskId, dependsOnId);
  if (result.changes) {
    recordChange(
      db,
      task.workspace_id,
      'task_dependency',
      `${taskId}:${dependsOnId}`,
      'delete',
      { task_id: taskId, depends_on_id: dependsOnId },
      clientId
    );
  }
  return { deleted: result.changes ?? 0 };
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
