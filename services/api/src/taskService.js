import { randomUUID } from 'node:crypto';
import { applyCheckIn, applyWaitingFollowup, TaskStatus } from '../../../packages/core/taskState.js';
import { compareTasksByPriority } from '../../../packages/core/priority.js';
import { buildAdjacency } from '../../../packages/core/tree.js';

const DEFAULT_ORG_ID = process.env.BRIANHUB_ORG_ID ?? 'org-default';

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
const NOTICE_RECURRENCE_UNITS = new Set(['day', 'week', 'month', 'year']);

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

function normalizeNoticeRecurrence(intervalValue, unitValue) {
  const interval = Number(intervalValue);
  if (!Number.isFinite(interval) || interval <= 0) {
    return { interval: null, unit: null };
  }
  const unit = NOTICE_RECURRENCE_UNITS.has(unitValue) ? unitValue : 'month';
  return { interval, unit };
}

function normalizeNoticeRecurrenceRuleJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeNoticeOccurrenceCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
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

async function ensureOrg(db, orgId, name = 'Default') {
  const existing = await getRow(db, 'SELECT id FROM orgs WHERE id = ?', [orgId]);
  if (existing) return;
  const timestamp = nowIso();
  await run(
    db,
    'INSERT INTO orgs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [orgId, name, timestamp, timestamp]
  );
}

async function run(db, sql, params = []) {
  await db.exec(sql, params);
}

async function getRow(db, sql, params = []) {
  return db.queryOne(sql, params);
}

async function getRows(db, sql, params = []) {
  return db.query(sql, params);
}

export async function recordChange(db, workspaceId, entityType, entityId, action, payload, clientId = null) {
  await run(
    db,
    'INSERT INTO change_log (workspace_id, entity_type, entity_id, action, payload, client_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [workspaceId, entityType, entityId, action, JSON.stringify(payload ?? {}), clientId, nowIso()]
  );
}

export async function getWorkspace(db, id, orgId = DEFAULT_ORG_ID) {
  return getRow(db, 'SELECT * FROM workspaces WHERE id = ? AND org_id = ?', [id, orgId]);
}

export async function createWorkspace(db, { id: providedId, name, type, org_id: orgId = DEFAULT_ORG_ID, org_name }) {
  if (providedId) {
    const existing = await getWorkspace(db, providedId, orgId);
    if (existing) return existing;
  }
  const id = providedId ?? randomUUID();
  const timestamp = nowIso();
  await ensureOrg(db, orgId, org_name ?? (orgId === DEFAULT_ORG_ID ? 'Default' : orgId));
  await run(
    db,
    'INSERT INTO workspaces (id, org_id, name, type, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, orgId, name, type, 0, timestamp, timestamp]
  );
  await seedWorkspaceStatuses(db, id);
  await seedWorkspaceTaskTypes(db, id);
  await seedWorkspaceNoticeTypes(db, id);
  return getWorkspace(db, id, orgId);
}

export async function listWorkspaces(db, orgId = DEFAULT_ORG_ID) {
  return getRows(db, 'SELECT * FROM workspaces WHERE org_id = ?', [orgId]);
}

export async function updateWorkspace(db, id, patch, clientId = null) {
  const existing = await getWorkspace(db, id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    type: patch.type ?? existing.type,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE workspaces SET name = ?, type = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.name, next.type, next.archived, next.updated_at, id]
  );
  await recordChange(db, id, 'workspace', id, 'update', patch, clientId);
  return getWorkspace(db, id);
}

export async function deleteWorkspace(db, id, clientId = null) {
  const existing = await getWorkspace(db, id);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM workspaces WHERE id = ?', [id]);
  await recordChange(db, id, 'workspace', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function getProject(db, id) {
  return getRow(db, 'SELECT * FROM projects WHERE id = ?', [id]);
}

export async function listProjects(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(db, 'SELECT * FROM projects WHERE workspace_id = ?', [workspaceId]);
}

export async function createProject(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getProject(db, data.id);
    if (existing) return existing;
  }
  const id = data?.id ?? randomUUID();
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
  await run(
    db,
    'INSERT INTO projects (id, workspace_id, name, kind, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      project.id,
      project.workspace_id,
      project.name,
      project.kind,
      project.archived,
      project.created_at,
      project.updated_at
    ]
  );
  await recordChange(db, project.workspace_id, 'project', id, 'create', project, clientId);
  return getProject(db, id);
}

export async function updateProject(db, id, patch, clientId = null) {
  const existing = await getProject(db, id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    kind: patch.kind ?? existing.kind,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE projects SET name = ?, kind = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.name, next.kind, next.archived, next.updated_at, id]
  );
  await recordChange(db, existing.workspace_id, 'project', id, 'update', patch, clientId);
  return getProject(db, id);
}

export async function deleteProject(db, id, clientId = null) {
  const existing = await getProject(db, id);
  if (!existing) return { deleted: 0 };
  await db.transaction(async (tx) => {
    await run(tx, 'UPDATE tasks SET project_id = NULL WHERE project_id = ?', [id]);
    await run(tx, 'DELETE FROM projects WHERE id = ?', [id]);
  });
  await recordChange(db, existing.workspace_id, 'project', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function getTemplate(db, id) {
  const row = await getRow(db, 'SELECT * FROM templates WHERE id = ?', [id]);
  return normalizeTemplateRow(row);
}

export async function listTemplates(db, workspaceId) {
  if (!workspaceId) return [];
  const rows = await getRows(db, 'SELECT * FROM templates WHERE workspace_id = ?', [workspaceId]);
  return rows.map(normalizeTemplateRow);
}

export async function createTemplate(db, data, clientId = null) {
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
  await run(
    db,
    `INSERT INTO templates (
      id, workspace_id, project_id, name, steps_json, lead_days, next_event_date,
      recurrence_interval, recurrence_unit, archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ]
  );
  await recordChange(db, template.workspace_id, 'template', id, 'create', template, clientId);
  return getTemplate(db, id);
}

export async function updateTemplate(db, id, patch, clientId = null) {
  const existing = await getRow(db, 'SELECT * FROM templates WHERE id = ?', [id]);
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
  await run(
    db,
    `UPDATE templates SET
      name = ?, project_id = ?, steps_json = ?, lead_days = ?, next_event_date = ?,
      recurrence_interval = ?, recurrence_unit = ?, archived = ?, updated_at = ?
     WHERE id = ?`,
    [
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
    ]
  );
  await recordChange(db, existing.workspace_id, 'template', id, 'update', patch, clientId);
  return getTemplate(db, id);
}

export async function deleteTemplate(db, id, clientId = null) {
  const existing = await getRow(db, 'SELECT * FROM templates WHERE id = ?', [id]);
  if (!existing) return { deleted: 0 };
  await db.transaction(async (tx) => {
    await run(tx, 'UPDATE tasks SET template_id = NULL WHERE template_id = ?', [id]);
    await run(tx, 'DELETE FROM templates WHERE id = ?', [id]);
  });
  await recordChange(db, existing.workspace_id, 'template', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function getShoppingList(db, id) {
  return getRow(db, 'SELECT * FROM shopping_lists WHERE id = ?', [id]);
}

export async function listShoppingLists(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(db, 'SELECT * FROM shopping_lists WHERE workspace_id = ?', [workspaceId]);
}

export async function createShoppingList(db, data, clientId = null) {
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
  await run(
    db,
    'INSERT INTO shopping_lists (id, workspace_id, name, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [list.id, list.workspace_id, list.name, list.archived, list.created_at, list.updated_at]
  );
  await recordChange(db, list.workspace_id, 'shopping_list', id, 'create', list, clientId);
  return getShoppingList(db, id);
}

export async function updateShoppingList(db, id, patch, clientId = null) {
  const existing = await getShoppingList(db, id);
  if (!existing) return null;
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived ?? 0,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE shopping_lists SET name = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.name, next.archived, next.updated_at, id]
  );
  await recordChange(db, existing.workspace_id, 'shopping_list', id, 'update', patch, clientId);
  return getShoppingList(db, id);
}

export async function deleteShoppingList(db, id, clientId = null) {
  const existing = await getShoppingList(db, id);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM shopping_lists WHERE id = ?', [id]);
  await recordChange(db, existing.workspace_id, 'shopping_list', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function getShoppingItem(db, id) {
  return getRow(db, 'SELECT * FROM shopping_list_items WHERE id = ?', [id]);
}

export async function listShoppingItems(db, workspaceId, listId = null) {
  if (listId) {
    return getRows(
      db,
      'SELECT * FROM shopping_list_items WHERE list_id = ? ORDER BY sort_order ASC, created_at ASC',
      [listId]
    );
  }
  if (!workspaceId) return [];
  return getRows(
    db,
    `SELECT items.* FROM shopping_list_items items
     JOIN shopping_lists lists ON lists.id = items.list_id
     WHERE lists.workspace_id = ?
     ORDER BY items.sort_order ASC, items.created_at ASC`,
    [workspaceId]
  );
}

export async function createShoppingItems(db, listId, items, clientId = null) {
  const list = await getShoppingList(db, listId);
  if (!list) return [];
  const timestamp = nowIso();
  const maxRow = await getRow(
    db,
    'SELECT MAX(sort_order) AS max_sort FROM shopping_list_items WHERE list_id = ?',
    [listId]
  );
  let sortOrder = Number(maxRow?.max_sort ?? 0);
  const created = [];
  await db.transaction(async (tx) => {
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
      await run(
        tx,
        'INSERT INTO shopping_list_items (id, list_id, name, is_checked, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          record.id,
          record.list_id,
          record.name,
          record.is_checked,
          record.sort_order,
          record.created_at,
          record.updated_at
        ]
      );
      await recordChange(tx, list.workspace_id, 'shopping_item', record.id, 'create', record, clientId);
      created.push(record);
    }
  });
  return Promise.all(created.map(item => getShoppingItem(db, item.id)));
}

export async function createShoppingItem(db, data, clientId = null) {
  const list = await getShoppingList(db, data.list_id);
  if (!list) return null;
  const timestamp = nowIso();
  const maxRow = await getRow(
    db,
    'SELECT MAX(sort_order) AS max_sort FROM shopping_list_items WHERE list_id = ?',
    [data.list_id]
  );
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
  await run(
    db,
    'INSERT INTO shopping_list_items (id, list_id, name, is_checked, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      item.id,
      item.list_id,
      item.name,
      item.is_checked,
      item.sort_order,
      item.created_at,
      item.updated_at
    ]
  );
  await recordChange(db, list.workspace_id, 'shopping_item', item.id, 'create', item, clientId);
  return getShoppingItem(db, item.id);
}

export async function updateShoppingItem(db, id, patch, clientId = null) {
  const existing = await getShoppingItem(db, id);
  if (!existing) return null;
  const list = await getShoppingList(db, existing.list_id);
  const next = {
    ...existing,
    name: patch.name ?? existing.name,
    is_checked: patch.is_checked !== undefined ? (patch.is_checked ? 1 : 0) : existing.is_checked ?? 0,
    sort_order: Number.isFinite(patch.sort_order) ? patch.sort_order : existing.sort_order,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE shopping_list_items SET name = ?, is_checked = ?, sort_order = ?, updated_at = ? WHERE id = ?',
    [next.name, next.is_checked, next.sort_order, next.updated_at, id]
  );
  if (list) {
    await recordChange(db, list.workspace_id, 'shopping_item', id, 'update', patch, clientId);
  }
  return getShoppingItem(db, id);
}

export async function deleteShoppingItem(db, id, clientId = null) {
  const existing = await getShoppingItem(db, id);
  if (!existing) return { deleted: 0 };
  const list = await getShoppingList(db, existing.list_id);
  await run(db, 'DELETE FROM shopping_list_items WHERE id = ?', [id]);
  if (list) {
    await recordChange(db, list.workspace_id, 'shopping_item', id, 'delete', {}, clientId);
  }
  return { deleted: 1 };
}

export async function listNotices(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(db, 'SELECT * FROM notices WHERE workspace_id = ? ORDER BY notify_at ASC', [workspaceId]);
}

async function getNotice(db, id) {
  return getRow(db, 'SELECT * FROM notices WHERE id = ?', [id]);
}

export async function createNotice(db, data, clientId = null) {
  const id = randomUUID();
  const timestamp = nowIso();
  const title = (data.title ?? '').trim();
  const notifyAt = data.notify_at ?? null;
  if (!title || !notifyAt) {
    throw new Error('Invalid notice');
  }
  const { interval: recurrenceInterval, unit: recurrenceUnit } = normalizeNoticeRecurrence(
    data.recurrence_interval,
    data.recurrence_unit
  );
  const recurrenceRuleJson = normalizeNoticeRecurrenceRuleJson(data.recurrence_rule_json ?? data.recurrence_rule);
  const recurrenceOccurrenceCount = normalizeNoticeOccurrenceCount(data.recurrence_occurrence_count);
  const notice = {
    id,
    workspace_id: data.workspace_id,
    title,
    notify_at: notifyAt,
    notice_type: data.notice_type ?? 'general',
    notice_sent_at: data.notice_sent_at ?? null,
    recurrence_interval: recurrenceInterval,
    recurrence_unit: recurrenceUnit,
    recurrence_rule_json: recurrenceRuleJson,
    recurrence_occurrence_count: recurrenceOccurrenceCount,
    dismissed_at: data.dismissed_at ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };
  await run(
    db,
    `INSERT INTO notices (
      id, workspace_id, title, notify_at, notice_type, notice_sent_at, recurrence_interval,
      recurrence_unit, recurrence_rule_json, recurrence_occurrence_count, dismissed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      notice.id,
      notice.workspace_id,
      notice.title,
      notice.notify_at,
      notice.notice_type,
      notice.notice_sent_at,
      notice.recurrence_interval,
      notice.recurrence_unit,
      notice.recurrence_rule_json,
      notice.recurrence_occurrence_count,
      notice.dismissed_at,
      notice.created_at,
      notice.updated_at
    ]
  );
  await recordChange(db, notice.workspace_id, 'notice', id, 'create', notice, clientId);
  return getNotice(db, id);
}

export async function updateNotice(db, id, patch, clientId = null) {
  const existing = await getNotice(db, id);
  if (!existing) return null;
  const { interval: recurrenceInterval, unit: recurrenceUnit } = normalizeNoticeRecurrence(
    'recurrence_interval' in patch ? patch.recurrence_interval : existing.recurrence_interval,
    'recurrence_unit' in patch ? patch.recurrence_unit : existing.recurrence_unit
  );
  const next = {
    ...existing,
    title: patch.title !== undefined ? String(patch.title).trim() : existing.title,
    notify_at: patch.notify_at ?? existing.notify_at,
    notice_type: patch.notice_type ?? existing.notice_type ?? 'general',
    notice_sent_at: patch.notice_sent_at ?? existing.notice_sent_at,
    recurrence_interval: recurrenceInterval,
    recurrence_unit: recurrenceUnit,
    recurrence_rule_json: ('recurrence_rule_json' in patch || 'recurrence_rule' in patch)
      ? normalizeNoticeRecurrenceRuleJson(patch.recurrence_rule_json ?? patch.recurrence_rule)
      : existing.recurrence_rule_json,
    recurrence_occurrence_count: ('recurrence_occurrence_count' in patch)
      ? normalizeNoticeOccurrenceCount(patch.recurrence_occurrence_count)
      : normalizeNoticeOccurrenceCount(existing.recurrence_occurrence_count),
    dismissed_at: patch.dismissed_at ?? existing.dismissed_at,
    updated_at: nowIso()
  };
  await run(
    db,
    `UPDATE notices SET
      title = ?, notify_at = ?, notice_type = ?, notice_sent_at = ?, recurrence_interval = ?,
      recurrence_unit = ?, recurrence_rule_json = ?, recurrence_occurrence_count = ?,
      dismissed_at = ?, updated_at = ? WHERE id = ?`,
    [
      next.title,
      next.notify_at,
      next.notice_type,
      next.notice_sent_at,
      next.recurrence_interval,
      next.recurrence_unit,
      next.recurrence_rule_json,
      next.recurrence_occurrence_count,
      next.dismissed_at,
      next.updated_at,
      id
    ]
  );
  await recordChange(db, existing.workspace_id, 'notice', id, 'update', patch, clientId);
  return getNotice(db, id);
}

export async function deleteNotice(db, id, clientId = null) {
  const existing = await getNotice(db, id);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM notices WHERE id = ?', [id]);
  await recordChange(db, existing.workspace_id, 'notice', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function listNoticeTypes(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(db, 'SELECT * FROM notice_types WHERE workspace_id = ? ORDER BY label ASC', [workspaceId]);
}

async function getNoticeType(db, id) {
  return getRow(db, 'SELECT * FROM notice_types WHERE id = ?', [id]);
}

async function getNoticeTypeByKey(db, workspaceId, key) {
  return getRow(db, 'SELECT * FROM notice_types WHERE workspace_id = ? AND key = ?', [workspaceId, key]);
}

async function getNoticeTypeByLabel(db, workspaceId, label) {
  return getRow(db, 'SELECT * FROM notice_types WHERE workspace_id = ? AND label = ?', [workspaceId, label]);
}

async function generateNoticeTypeKey(db, workspaceId, label) {
  const base = slugify(label || 'type');
  let key = base || 'type';
  let suffix = 1;
  while (await getNoticeTypeByKey(db, workspaceId, key)) {
    suffix += 1;
    key = `${base}-${suffix}`;
  }
  return key;
}

export async function createNoticeType(db, data, clientId = null) {
  const label = String(data.label ?? '').trim();
  if (!label) throw new Error('Label required');
  const existing = await getNoticeTypeByLabel(db, data.workspace_id, label);
  if (existing) return existing;
  const id = randomUUID();
  const timestamp = nowIso();
  const key = await generateNoticeTypeKey(db, data.workspace_id, label);
  await run(
    db,
    'INSERT INTO notice_types (id, workspace_id, key, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, data.workspace_id, key, label, timestamp, timestamp]
  );
  await recordChange(db, data.workspace_id, 'notice_type', id, 'create', { key, label }, clientId);
  return getNoticeType(db, id);
}

export async function updateNoticeType(db, id, patch, clientId = null) {
  const existing = await getNoticeType(db, id);
  if (!existing) return null;
  const nextLabel = patch.label !== undefined ? String(patch.label).trim() : existing.label;
  const next = {
    ...existing,
    label: nextLabel || existing.label,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE notice_types SET label = ?, updated_at = ? WHERE id = ?',
    [next.label, next.updated_at, id]
  );
  await recordChange(db, existing.workspace_id, 'notice_type', id, 'update', patch, clientId);
  return getNoticeType(db, id);
}

export async function deleteNoticeType(db, id, clientId = null) {
  const existing = await getNoticeType(db, id);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM notice_types WHERE id = ?', [id]);
  await recordChange(db, existing.workspace_id, 'notice_type', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function listStoreRules(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(db, 'SELECT * FROM store_rules WHERE workspace_id = ? ORDER BY store_name ASC', [workspaceId]);
}

async function getStoreRule(db, id) {
  return getRow(db, 'SELECT * FROM store_rules WHERE id = ?', [id]);
}

export async function createStoreRule(db, data, clientId = null) {
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
  await run(
    db,
    'INSERT INTO store_rules (id, workspace_id, store_name, keywords_json, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      rule.id,
      rule.workspace_id,
      rule.store_name,
      rule.keywords_json,
      rule.archived,
      rule.created_at,
      rule.updated_at
    ]
  );
  await recordChange(db, rule.workspace_id, 'store_rule', id, 'create', rule, clientId);
  return getStoreRule(db, id);
}

export async function updateStoreRule(db, id, patch, clientId = null) {
  const existing = await getStoreRule(db, id);
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
  await run(
    db,
    'UPDATE store_rules SET store_name = ?, keywords_json = ?, archived = ?, updated_at = ? WHERE id = ?',
    [next.store_name, next.keywords_json, next.archived, next.updated_at, id]
  );
  await recordChange(db, existing.workspace_id, 'store_rule', id, 'update', patch, clientId);
  return getStoreRule(db, id);
}

export async function deleteStoreRule(db, id, clientId = null) {
  const existing = await getStoreRule(db, id);
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM store_rules WHERE id = ?', [id]);
  await recordChange(db, existing.workspace_id, 'store_rule', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function listTaskTypes(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(db, 'SELECT * FROM task_types WHERE workspace_id = ? ORDER BY is_default DESC, name ASC', [workspaceId]);
}

async function getTaskType(db, id) {
  return getRow(db, 'SELECT * FROM task_types WHERE id = ?', [id]);
}

async function getTaskTypeByName(db, workspaceId, name) {
  if (!workspaceId || !name) return null;
  return getRow(db, 'SELECT * FROM task_types WHERE workspace_id = ? AND name = ?', [workspaceId, name]);
}

async function getDefaultTaskType(db, workspaceId) {
  if (!workspaceId) return null;
  return getRow(
    db,
    'SELECT * FROM task_types WHERE workspace_id = ? AND is_default = 1 ORDER BY name ASC LIMIT 1',
    [workspaceId]
  );
}

export async function createTaskType(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getTaskType(db, data.id);
    if (existing) return existing;
  }
  const id = data?.id ?? randomUUID();
  const timestamp = nowIso();
  const name = (data.name ?? '').trim();
  if (!name) throw new Error('Invalid task type name');
  if (await getTaskTypeByName(db, data.workspace_id, name)) {
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
  await run(
    db,
    'INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [type.id, type.workspace_id, type.name, type.is_default, type.archived, type.created_at, type.updated_at]
  );
  await recordChange(db, type.workspace_id, 'task_type', id, 'create', type, clientId);
  return getTaskType(db, id);
}

export async function updateTaskType(db, id, patch, clientId = null) {
  const existing = await getTaskType(db, id);
  if (!existing) return null;
  const nextName = patch.name !== undefined ? String(patch.name).trim() : existing.name;
  if (!nextName) throw new Error('Invalid task type name');
  if (nextName !== existing.name && await getTaskTypeByName(db, existing.workspace_id, nextName)) {
    throw new Error('Task type already exists');
  }
  const next = {
    ...existing,
    name: nextName,
    archived: patch.archived !== undefined ? (patch.archived ? 1 : 0) : existing.archived,
    updated_at: nowIso()
  };
  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE task_types SET name = ?, archived = ?, updated_at = ? WHERE id = ?',
      [next.name, next.archived, next.updated_at, id]
    );
    if (next.name !== existing.name) {
      await run(
        tx,
        'UPDATE tasks SET type_label = ?, updated_at = ? WHERE workspace_id = ? AND type_label = ?',
        [next.name, next.updated_at, existing.workspace_id, existing.name]
      );
    }
  });
  await recordChange(db, existing.workspace_id, 'task_type', id, 'update', patch, clientId);
  return getTaskType(db, id);
}

export async function deleteTaskType(db, id, clientId = null) {
  const existing = await getTaskType(db, id);
  if (!existing) return { deleted: 0 };
  if (existing.is_default) {
    return { deleted: 0, error: 'protected' };
  }
  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE tasks SET type_label = NULL, updated_at = ? WHERE workspace_id = ? AND type_label = ?',
      [nowIso(), existing.workspace_id, existing.name]
    );
    await run(tx, 'DELETE FROM task_types WHERE id = ?', [id]);
  });
  await recordChange(db, existing.workspace_id, 'task_type', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function listStatuses(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(
    db,
    'SELECT * FROM workspace_statuses WHERE workspace_id = ? ORDER BY sort_order ASC, created_at ASC',
    [workspaceId]
  );
}

export async function getStatusByKey(db, workspaceId, key) {
  if (!workspaceId || !key) return null;
  return getRow(db, 'SELECT * FROM workspace_statuses WHERE workspace_id = ? AND key = ?', [workspaceId, key]);
}

async function getStatusById(db, id) {
  if (!id) return null;
  return getRow(db, 'SELECT * FROM workspace_statuses WHERE id = ?', [id]);
}

async function getFallbackStatus(db, workspaceId) {
  if (!workspaceId) return null;
  const inbox = await getRow(
    db,
    'SELECT * FROM workspace_statuses WHERE workspace_id = ? AND kind = ?',
    [workspaceId, TaskStatus.INBOX]
  );
  if (inbox) return inbox;
  return getRow(
    db,
    'SELECT * FROM workspace_statuses WHERE workspace_id = ? ORDER BY sort_order ASC LIMIT 1',
    [workspaceId]
  );
}

async function ensureStatusKeyUnique(db, workspaceId, baseKey) {
  let key = baseKey;
  let suffix = 2;
  while (await getRow(db, 'SELECT 1 FROM workspace_statuses WHERE workspace_id = ? AND key = ?', [workspaceId, key])) {
    key = `${baseKey}-${suffix}`;
    suffix += 1;
  }
  return key;
}

export async function createStatus(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getStatusById(db, data.id);
    if (existing) return existing;
  }
  const id = data?.id ?? randomUUID();
  const timestamp = nowIso();
  const label = (data.label ?? '').trim();
  const keyBase = data.key ? slugify(data.key) : slugify(label);
  if (!keyBase) throw new Error('Invalid status key');
  const key = await ensureStatusKeyUnique(db, data.workspace_id, keyBase);
  const maxRow = await getRow(
    db,
    'SELECT MAX(sort_order) AS max_sort FROM workspace_statuses WHERE workspace_id = ?',
    [data.workspace_id]
  );
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
  await run(
    db,
    `INSERT INTO workspace_statuses
      (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      status.id,
      status.workspace_id,
      status.key,
      status.label,
      status.kind,
      status.sort_order,
      status.kanban_visible,
      status.created_at,
      status.updated_at
    ]
  );
  await recordChange(db, status.workspace_id, 'status', id, 'create', status, clientId);
  return getStatusByKey(db, status.workspace_id, status.key);
}

export async function updateStatus(db, id, patch, clientId = null) {
  const existing = await getRow(db, 'SELECT * FROM workspace_statuses WHERE id = ?', [id]);
  if (!existing) return null;
  const nextLabel = patch.label !== undefined ? String(patch.label).trim() : existing.label;
  const next = {
    ...existing,
    label: nextLabel || existing.label,
    sort_order: Number.isFinite(patch.sort_order) ? patch.sort_order : existing.sort_order,
    kanban_visible: patch.kanban_visible !== undefined ? (patch.kanban_visible ? 1 : 0) : existing.kanban_visible,
    updated_at: nowIso()
  };
  await run(
    db,
    'UPDATE workspace_statuses SET label = ?, sort_order = ?, kanban_visible = ?, updated_at = ? WHERE id = ?',
    [next.label, next.sort_order, next.kanban_visible, next.updated_at, id]
  );
  await recordChange(db, existing.workspace_id, 'status', id, 'update', patch, clientId);
  return getRow(db, 'SELECT * FROM workspace_statuses WHERE id = ?', [id]);
}

export async function deleteStatus(db, id, clientId = null) {
  const existing = await getRow(db, 'SELECT * FROM workspace_statuses WHERE id = ?', [id]);
  if (!existing) return { deleted: 0 };
  if (existing.kind !== 'custom') {
    return { deleted: 0, error: 'protected' };
  }
  const fallback = await getFallbackStatus(db, existing.workspace_id);
  const fallbackKey = fallback?.key ?? TaskStatus.INBOX;
  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE tasks SET status = ?, updated_at = ? WHERE workspace_id = ? AND status = ?',
      [fallbackKey, nowIso(), existing.workspace_id, existing.key]
    );
    await run(tx, 'DELETE FROM workspace_statuses WHERE id = ?', [id]);
  });
  await recordChange(db, existing.workspace_id, 'status', id, 'delete', {}, clientId);
  return { deleted: 1 };
}

export async function seedWorkspaceStatuses(db, workspaceId) {
  const timestamp = nowIso();
  for (const status of DEFAULT_STATUSES) {
    const existing = await getStatusByKey(db, workspaceId, status.key);
    if (existing) continue;
    await run(
      db,
      `INSERT INTO workspace_statuses
        (id, workspace_id, key, label, kind, sort_order, kanban_visible, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        workspaceId,
        status.key,
        status.label,
        status.kind,
        status.sort_order,
        status.kanban_visible,
        timestamp,
        timestamp
      ]
    );
  }
}

export async function seedWorkspaceTaskTypes(db, workspaceId) {
  const timestamp = nowIso();
  for (const type of DEFAULT_TASK_TYPES) {
    const existing = await getTaskTypeByName(db, workspaceId, type.name);
    if (existing) continue;
    await run(
      db,
      'INSERT INTO task_types (id, workspace_id, name, is_default, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        randomUUID(),
        workspaceId,
        type.name,
        type.is_default ? 1 : 0,
        0,
        timestamp,
        timestamp
      ]
    );
  }
}

export async function seedWorkspaceNoticeTypes(db, workspaceId) {
  const timestamp = nowIso();
  for (const type of DEFAULT_NOTICE_TYPES) {
    const existing = await getRow(
      db,
      'SELECT 1 FROM notice_types WHERE workspace_id = ? AND key = ?',
      [workspaceId, type.key]
    );
    if (existing) continue;
    await run(
      db,
      'INSERT INTO notice_types (id, workspace_id, key, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), workspaceId, type.key, type.label, timestamp, timestamp]
    );
  }
}

export async function createTask(db, data, clientId = null) {
  if (data?.id) {
    const existing = await getTask(db, data.id);
    if (existing) return existing;
  }
  const id = data?.id ?? randomUUID();
  const timestamp = nowIso();
  const fallbackStatus = await getFallbackStatus(db, data.workspace_id);
  const statusKey = data.status ?? fallbackStatus?.key ?? TaskStatus.INBOX;
  const statusRow = await getStatusByKey(db, data.workspace_id, statusKey);
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
    group_label: data.group_label ?? null,
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

  await db.transaction(async (tx) => {
    const insertColumns = [
      'id',
      'workspace_id',
      'parent_id',
      'project_id',
      'group_label',
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
      task.group_label,
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
    await run(tx, `INSERT INTO tasks (${insertColumns.join(', ')}) VALUES (${placeholders})`, insertValues);

    // closure table inserts
    await run(tx, 'INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, 0)', [id, id]);

    if (task.parent_id) {
      const ancestors = await getRows(
        tx,
        'SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ?',
        [task.parent_id]
      );
      for (const ancestor of ancestors) {
        await run(
          tx,
          'INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)',
          [ancestor.ancestor_id, id, ancestor.depth + 1]
        );
      }
    }

    await recordChange(tx, task.workspace_id, 'task', id, 'create', task, clientId);
  });

  return getRow(db, 'SELECT * FROM tasks WHERE id = ?', [id]);
}

export async function getTask(db, id) {
  return getRow(db, 'SELECT * FROM tasks WHERE id = ?', [id]);
}

export async function updateTask(db, id, patch, clientId = null) {
  const existing = await getTask(db, id);
  if (!existing) return null;
  const next = { ...existing, ...patch, updated_at: nowIso() };
  if ('urgency' in patch) next.urgency = patch.urgency ? 1 : 0;
  if ('auto_debit' in patch) next.auto_debit = patch.auto_debit ? 1 : 0;
  if ('template_prompt_pending' in patch) next.template_prompt_pending = patch.template_prompt_pending ? 1 : 0;

  if (patch.status && patch.status !== existing.status) {
    const statusRow = await getStatusByKey(db, existing.workspace_id, patch.status);
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
    'waiting_followup_at', 'next_checkin_at', 'sort_order', 'task_type', 'project_id', 'group_label'
  ];
  const values = fields.map(field => next[field]);
  await run(
    db,
    `UPDATE tasks SET ${fields.map(field => `${field} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    [...values, next.updated_at, id]
  );
  await recordChange(db, next.workspace_id, 'task', id, 'update', patch, clientId);
  return getTask(db, id);
}

export async function deleteTask(db, id, clientId = null) {
  const existing = await getTask(db, id);
  if (!existing) return { deleted: 0 };
  const descendants = await getRows(
    db,
    'SELECT descendant_id FROM task_edges WHERE ancestor_id = ?',
    [id]
  );
  const ids = descendants.map(row => row.descendant_id);
  if (ids.length === 0) return { deleted: 0 };

  const placeholders = ids.map(() => '?').join(',');
  await db.transaction(async (tx) => {
    await run(tx, `DELETE FROM tasks WHERE id IN (${placeholders})`, ids);
  });

  await recordChange(db, existing.workspace_id, 'task', id, 'delete', { ids }, clientId);
  return { deleted: ids.length, ids };
}

export async function listTasks(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(db, 'SELECT * FROM tasks WHERE workspace_id = ?', [workspaceId]);
}

export async function listTaskDependencies(db, workspaceId) {
  if (!workspaceId) return [];
  return getRows(db, 'SELECT * FROM task_dependencies WHERE workspace_id = ?', [workspaceId]);
}

export async function addTaskDependency(db, taskId, dependsOnId, clientId = null) {
  if (!taskId || !dependsOnId) throw new Error('Task ids required');
  if (taskId === dependsOnId) throw new Error('Task cannot depend on itself');
  const task = await getTask(db, taskId);
  const dependency = await getTask(db, dependsOnId);
  if (!task || !dependency) throw new Error('Task not found');
  if (task.workspace_id !== dependency.workspace_id) {
    throw new Error('Tasks must be in the same workspace');
  }
  const existing = await getRow(
    db,
    'SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?',
    [taskId, dependsOnId]
  );
  if (existing) return { task_id: taskId, depends_on_id: dependsOnId, workspace_id: task.workspace_id };
  const created_at = nowIso();
  await run(
    db,
    'INSERT INTO task_dependencies (task_id, depends_on_id, workspace_id, created_at) VALUES (?, ?, ?, ?)',
    [taskId, dependsOnId, task.workspace_id, created_at]
  );
  await recordChange(
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

export async function removeTaskDependency(db, taskId, dependsOnId, clientId = null) {
  if (!taskId || !dependsOnId) throw new Error('Task ids required');
  const task = await getTask(db, taskId);
  if (!task) throw new Error('Task not found');
  const existing = await getRow(
    db,
    'SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?',
    [taskId, dependsOnId]
  );
  if (!existing) return { deleted: 0 };
  await run(db, 'DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?', [taskId, dependsOnId]);
  await recordChange(
    db,
    task.workspace_id,
    'task_dependency',
    `${taskId}:${dependsOnId}`,
    'delete',
    { task_id: taskId, depends_on_id: dependsOnId },
    clientId
  );
  return { deleted: 1 };
}

export async function getTaskTree(db, workspaceId, rootId = null) {
  let tasks;
  if (rootId) {
    const descendants = await getRows(
      db,
      'SELECT descendant_id FROM task_edges WHERE ancestor_id = ?',
      [rootId]
    );
    const ids = descendants.map(row => row.descendant_id);
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    tasks = await getRows(db, `SELECT * FROM tasks WHERE id IN (${placeholders})`, ids);
  } else {
    tasks = await listTasks(db, workspaceId);
  }

  const tree = buildAdjacency(tasks);
  tree.forEach(sortTreeByPriority);
  return tree;
}

function sortTreeByPriority(node) {
  node.children.sort(compareTasksByPriority);
  node.children.forEach(sortTreeByPriority);
}

export async function reparentTask(db, taskId, newParentId, clientId = null) {
  if (taskId === newParentId) throw new Error('Cannot reparent task under itself');

  if (newParentId) {
    const cycle = await getRow(
      db,
      'SELECT 1 FROM task_edges WHERE ancestor_id = ? AND descendant_id = ? LIMIT 1',
      [taskId, newParentId]
    );
    if (cycle) throw new Error('Cannot reparent task under its descendant');
  }

  const descendants = await getRows(
    db,
    'SELECT descendant_id, depth FROM task_edges WHERE ancestor_id = ?',
    [taskId]
  );
  const ancestorRows = await getRows(
    db,
    'SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ? AND depth > 0',
    [taskId]
  );

  await db.transaction(async (tx) => {
    if (ancestorRows.length && descendants.length) {
      const ancestorIds = ancestorRows.map(row => row.ancestor_id);
      const descendantIds = descendants.map(row => row.descendant_id);
      const ancestorPlaceholders = ancestorIds.map(() => '?').join(',');
      const descendantPlaceholders = descendantIds.map(() => '?').join(',');
      await run(
        tx,
        `DELETE FROM task_edges WHERE ancestor_id IN (${ancestorPlaceholders}) AND descendant_id IN (${descendantPlaceholders})`,
        [...ancestorIds, ...descendantIds]
      );
    }

    if (newParentId) {
      const newAncestors = await getRows(
        tx,
        'SELECT ancestor_id, depth FROM task_edges WHERE descendant_id = ?',
        [newParentId]
      );
      for (const ancestor of newAncestors) {
        for (const descendant of descendants) {
          await run(
            tx,
            'INSERT INTO task_edges (ancestor_id, descendant_id, depth) VALUES (?, ?, ?)',
            [ancestor.ancestor_id, descendant.descendant_id, ancestor.depth + 1 + descendant.depth]
          );
        }
      }
    }

    await run(
      tx,
      'UPDATE tasks SET parent_id = ?, updated_at = ? WHERE id = ?',
      [newParentId ?? null, nowIso(), taskId]
    );
  });

  const updated = await getTask(db, taskId);
  await recordChange(db, updated.workspace_id, 'task', taskId, 'reparent', { new_parent_id: newParentId }, clientId);
  return updated;
}

export async function applyTaskCheckIn(db, taskId, response, clientId = null) {
  const task = await getTask(db, taskId);
  if (!task) return null;
  if (response === 'no') {
    await rescheduleSubtree(db, taskId, 24 * 60 * 60 * 1000, clientId);
  }
  const updated = applyCheckIn(task, response, new Date());

  await db.transaction(async (tx) => {
    await run(
      tx,
      'UPDATE tasks SET status = ?, completed_at = ?, next_checkin_at = ?, updated_at = ? WHERE id = ?',
      [updated.status, updated.completed_at, updated.next_checkin_at, nowIso(), taskId]
    );
    const checkinId = randomUUID();
    await run(
      tx,
      'INSERT INTO task_checkins (id, task_id, scheduled_at, response, responded_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        checkinId,
        taskId,
        task.next_checkin_at ?? nowIso(),
        response,
        nowIso(),
        nowIso()
      ]
    );
  });

  await recordChange(db, task.workspace_id, 'task', taskId, 'checkin', { response }, clientId);
  return getTask(db, taskId);
}

export async function rescheduleSubtree(db, taskId, deltaMs, clientId = null) {
  const descendants = await getRows(
    db,
    'SELECT descendant_id FROM task_edges WHERE ancestor_id = ?',
    [taskId]
  );
  const ids = descendants.map(row => row.descendant_id);
  if (ids.length === 0) return { updated: 0 };

  const placeholders = ids.map(() => '?').join(',');
  const tasks = await getRows(
    db,
    `SELECT id, start_at, due_at, next_checkin_at, workspace_id FROM tasks WHERE id IN (${placeholders})`,
    ids
  );
  await db.transaction(async (tx) => {
    for (const task of tasks) {
      const startAt = task.start_at ? new Date(task.start_at).getTime() + deltaMs : null;
      const dueAt = task.due_at ? new Date(task.due_at).getTime() + deltaMs : null;
      const nextCheck = task.next_checkin_at ? new Date(task.next_checkin_at).getTime() + deltaMs : null;
      await run(
        tx,
        'UPDATE tasks SET start_at = ?, due_at = ?, next_checkin_at = ?, updated_at = ? WHERE id = ?',
        [
          startAt ? new Date(startAt).toISOString() : null,
          dueAt ? new Date(dueAt).toISOString() : null,
          nextCheck ? new Date(nextCheck).toISOString() : null,
          nowIso(),
          task.id
        ]
      );
    }
  });

  if (tasks[0]) {
    await recordChange(db, tasks[0].workspace_id, 'task', taskId, 'reschedule', { deltaMs }, clientId);
  }
  return { updated: tasks.length };
}

export async function searchTasks(db, workspaceId, { text, status, tag }) {
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
  return getRows(db, `SELECT * FROM tasks WHERE ${where}`, params);
}
