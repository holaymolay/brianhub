import { TaskStatus, applyWaitingFollowup } from '../../packages/core/taskState.js';

function normalizeData(data = {}) {
  const next = { ...data };
  if (!Array.isArray(next.workspaces)) next.workspaces = [];
  if (!Array.isArray(next.projects)) next.projects = [];
  if (!Array.isArray(next.statuses)) next.statuses = [];
  if (!Array.isArray(next.taskTypes)) next.taskTypes = [];
  if (!next.tasks || typeof next.tasks !== 'object') next.tasks = {};
  if (!Array.isArray(next.taskDependencies)) next.taskDependencies = [];
  if (!Array.isArray(next.templates)) next.templates = [];
  if (!Array.isArray(next.notices)) next.notices = [];
  if (!Array.isArray(next.noticeTypes)) next.noticeTypes = [];
  if (!Array.isArray(next.storeRules)) next.storeRules = [];
  if (!Array.isArray(next.shoppingLists)) next.shoppingLists = [];
  if (!next.shoppingItems || typeof next.shoppingItems !== 'object') next.shoppingItems = {};
  return next;
}

function upsertById(list, item) {
  const next = Array.isArray(list) ? [...list] : [];
  const index = next.findIndex(entry => entry.id === item.id);
  if (index >= 0) {
    next[index] = { ...next[index], ...item };
  } else {
    next.push(item);
  }
  return next;
}

function removeById(list, id) {
  if (!Array.isArray(list)) return [];
  return list.filter(entry => entry.id !== id);
}

function getStatusKindFromData(data, key) {
  if (!key) return null;
  const status = (data.statuses ?? []).find(entry => entry.key === key);
  return status?.kind ?? key;
}

function applyTaskPatch(task, patch, data, context) {
  const now = context?.now instanceof Date
    ? context.now
    : context?.now
      ? new Date(context.now)
      : new Date();
  const updated = {
    ...task,
    ...patch,
    updated_at: patch.updated_at ?? task.updated_at ?? now.toISOString()
  };
  if ('status' in patch) {
    const statusKind = getStatusKindFromData(data, patch.status);
    if (statusKind === TaskStatus.WAITING) {
      if (!('next_checkin_at' in patch)) {
        const waitingTask = applyWaitingFollowup(
          { ...updated, status: TaskStatus.WAITING },
          now,
          context?.waitingDays
        );
        updated.next_checkin_at = waitingTask.next_checkin_at;
      }
    }
    if (statusKind === TaskStatus.DONE) {
      if (!updated.completed_at) {
        updated.completed_at = now.toISOString();
      }
    }
    if (statusKind !== TaskStatus.DONE && !('completed_at' in patch)) {
      updated.completed_at = null;
    }
  }
  return updated;
}

function applyTaskChange(data, change, context) {
  const next = { ...data, tasks: { ...data.tasks } };
  const id = change.entity_id;

  if (change.action === 'create') {
    const payload = change.payload ?? {};
    next.tasks[id] = { ...payload, id };
    return { data: next, needsRefresh: false };
  }

  if (change.action === 'update') {
    const existing = next.tasks[id] ?? { id };
    next.tasks[id] = applyTaskPatch(existing, change.payload ?? {}, next, context);
    return { data: next, needsRefresh: false };
  }

  if (change.action === 'reparent') {
    const existing = next.tasks[id];
    if (existing) {
      next.tasks[id] = { ...existing, parent_id: change.payload?.new_parent_id ?? null };
    }
    return { data: next, needsRefresh: false };
  }

  if (change.action === 'delete') {
    const ids = Array.isArray(change.payload?.ids) ? change.payload.ids : [id];
    ids.forEach(taskId => {
      delete next.tasks[taskId];
    });
    return { data: next, needsRefresh: false };
  }

  if (change.action === 'checkin' || change.action === 'reschedule') {
    return { data: next, needsRefresh: true };
  }

  return { data: next, needsRefresh: false };
}

function applyArrayChange(data, change, key) {
  const next = { ...data };
  const current = data[key] ?? [];
  if (change.action === 'create') {
    next[key] = upsertById(current, change.payload ?? { id: change.entity_id });
    return { data: next, needsRefresh: false };
  }
  if (change.action === 'update') {
    next[key] = upsertById(current, { id: change.entity_id, ...(change.payload ?? {}) });
    return { data: next, needsRefresh: false };
  }
  if (change.action === 'delete') {
    next[key] = removeById(current, change.entity_id);
    return { data: next, needsRefresh: false };
  }
  return { data: next, needsRefresh: false };
}

function applyMapChange(data, change, key) {
  const next = { ...data, [key]: { ...(data[key] ?? {}) } };
  const map = next[key];
  if (change.action === 'create') {
    map[change.entity_id] = { id: change.entity_id, ...(change.payload ?? {}) };
    return { data: next, needsRefresh: false };
  }
  if (change.action === 'update') {
    const existing = map[change.entity_id] ?? { id: change.entity_id };
    map[change.entity_id] = { ...existing, ...(change.payload ?? {}) };
    return { data: next, needsRefresh: false };
  }
  if (change.action === 'delete') {
    delete map[change.entity_id];
    return { data: next, needsRefresh: false };
  }
  return { data: next, needsRefresh: false };
}

export function applyRemoteChange(data, change, context = {}) {
  const nextData = normalizeData(data);
  if (!change || !change.entity_type) {
    return { data: nextData, needsRefresh: false };
  }

  switch (change.entity_type) {
    case 'task':
      return applyTaskChange(nextData, change, context);
    case 'project':
      return applyArrayChange(nextData, change, 'projects');
    case 'status':
      return applyArrayChange(nextData, change, 'statuses');
    case 'task_type':
      return applyArrayChange(nextData, change, 'taskTypes');
    case 'template':
      return applyArrayChange(nextData, change, 'templates');
    case 'notice':
      return applyArrayChange(nextData, change, 'notices');
    case 'notice_type':
      return applyArrayChange(nextData, change, 'noticeTypes');
    case 'store_rule':
      return applyArrayChange(nextData, change, 'storeRules');
    case 'shopping_list':
      return applyArrayChange(nextData, change, 'shoppingLists');
    case 'shopping_item':
      return applyMapChange(nextData, change, 'shoppingItems');
    case 'workspace':
      return { data: nextData, needsRefresh: true };
    default:
      return { data: nextData, needsRefresh: false };
  }
}

export function applyRemoteChanges(data, changes = [], context = {}) {
  let nextData = normalizeData(data);
  let needsRefresh = false;
  for (const change of changes) {
    const result = applyRemoteChange(nextData, change, context);
    nextData = result.data;
    if (result.needsRefresh) needsRefresh = true;
  }
  return { data: nextData, needsRefresh };
}
