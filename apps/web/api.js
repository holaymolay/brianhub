import { getClientId } from './clientId.js';
import { webConfig } from './config.js';
import { logger } from './logger.js';

const API_BASE = webConfig.apiBase;
const UI_STORAGE_KEY = 'brianhub_ui_v1';
let requestIdCounter = 0;

function emitApiEvent(detail) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('brianhub:api', { detail }));
}

function getActorEmailFromUiState() {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(UI_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const email = String(parsed?.ui?.profile?.email ?? '').trim().toLowerCase();
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    return email;
  } catch {
    return null;
  }
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  requestIdCounter += 1;
  return `web-${Date.now().toString(36)}-${requestIdCounter.toString(36)}`;
}

function tryParseJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const method = options.method ?? 'GET';
  const startedAt = Date.now();
  const actorEmail = getActorEmailFromUiState();
  const requestId = createRequestId();
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': getClientId(),
        'X-Request-Id': requestId,
        ...(actorEmail ? { 'X-Actor-Email': actorEmail } : {}),
        ...(options.headers ?? {})
      },
      ...options
    });
  } catch (error) {
    logger.error('API request failed before response', {
      requestId,
      method,
      path,
      message: error?.message ?? 'Network request failed'
    });
    emitApiEvent({
      request_id: requestId,
      method,
      path,
      ok: false,
      status: null,
      duration_ms: Date.now() - startedAt,
      error: error?.message ?? 'Network request failed'
    });
    throw error;
  }

  const durationMs = Date.now() - startedAt;
  const responseRequestId = res.headers.get('x-request-id') || requestId;
  if (!res.ok) {
    const text = await res.text();
    const parsed = tryParseJson(text);
    const responseError = parsed?.error;
    const message = typeof responseError?.message === 'string'
      ? responseError.message
      : (text || `Request failed: ${res.status}`);
    logger.error('API request failed', {
      requestId: responseRequestId,
      method,
      path,
      status: res.status,
      durationMs,
      message
    });
    emitApiEvent({
      request_id: responseRequestId,
      method,
      path,
      ok: false,
      status: res.status,
      duration_ms: durationMs,
      error: message.slice(0, 1000)
    });
    const err = new Error(message);
    err.status = res.status;
    err.body = text;
    err.requestId = responseError?.requestId ?? responseRequestId;
    err.code = responseError?.code ?? null;
    err.conflict = responseError?.conflict ?? null;
    throw err;
  }

  emitApiEvent({
    request_id: responseRequestId,
    method,
    path,
    ok: true,
    status: res.status,
    duration_ms: durationMs
  });

  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch (error) {
    logger.warn('API response was not JSON', {
      requestId: responseRequestId,
      method,
      path,
      status: res.status,
      durationMs
    });
    throw error;
  }
}

export function listWorkspaces() {
  return request('/workspaces');
}

export function createWorkspace(data) {
  return request('/workspaces', { method: 'POST', body: JSON.stringify(data) });
}

export function listOrgs() {
  return request('/orgs');
}

export function createOrg(data) {
  return request('/orgs', { method: 'POST', body: JSON.stringify(data) });
}

export function listUsers({ orgId = null, workspaceId = null } = {}) {
  const params = new URLSearchParams();
  if (orgId) params.set('org_id', orgId);
  if (workspaceId) params.set('workspace_id', workspaceId);
  return request(`/users?${params.toString()}`);
}

export function createUser(data) {
  return request('/users', { method: 'POST', body: JSON.stringify(data) });
}

export function updateUser(id, patch) {
  return request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function getAdminInfo() {
  return request('/admin/info');
}

export function listAdminInvites({ orgId = null, workspaceId = null, status = 'pending' } = {}) {
  const params = new URLSearchParams();
  if (orgId) params.set('org_id', orgId);
  if (workspaceId) params.set('workspace_id', workspaceId);
  if (status) params.set('status', status);
  return request(`/admin/invites?${params.toString()}`);
}

export function createAdminInvite(data) {
  return request('/admin/invites', { method: 'POST', body: JSON.stringify(data) });
}

export function listWorkspaceMemberships(workspaceId) {
  return request(`/workspace-memberships?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createWorkspaceMembership(data) {
  return request('/workspace-memberships', { method: 'POST', body: JSON.stringify(data) });
}

export function updateWorkspaceMembership(id, patch) {
  return request(`/workspace-memberships/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteWorkspaceMembership(id) {
  return request(`/workspace-memberships/${id}`, { method: 'DELETE' });
}

export function updateWorkspace(id, patch) {
  return request(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteWorkspace(id) {
  return request(`/workspaces/${id}`, { method: 'DELETE' });
}

export function listProjects(workspaceId) {
  return request(`/projects?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createProject(data) {
  return request('/projects', { method: 'POST', body: JSON.stringify(data) });
}

export function updateProject(id, patch) {
  return request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteProject(id) {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function listTemplates(workspaceId) {
  return request(`/templates?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createTemplate(data) {
  return request('/templates', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTemplate(id, patch) {
  return request(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteTemplate(id) {
  return request(`/templates/${id}`, { method: 'DELETE' });
}

export function listStatuses(workspaceId) {
  return request(`/statuses?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createStatus(data) {
  return request('/statuses', { method: 'POST', body: JSON.stringify(data) });
}

export function updateStatus(id, patch) {
  return request(`/statuses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteStatus(id) {
  return request(`/statuses/${id}`, { method: 'DELETE' });
}

export function listTaskTypes(workspaceId) {
  return request(`/task-types?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createTaskType(data) {
  return request('/task-types', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTaskType(id, patch) {
  return request(`/task-types/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteTaskType(id) {
  return request(`/task-types/${id}`, { method: 'DELETE' });
}

export function listNotices(workspaceId) {
  return request(`/notices?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createNotice(data) {
  return request('/notices', { method: 'POST', body: JSON.stringify(data) });
}

export function updateNotice(id, patch) {
  return request(`/notices/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteNotice(id) {
  return request(`/notices/${id}`, { method: 'DELETE' });
}

export function listNoticeTypes(workspaceId) {
  return request(`/notice-types?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createNoticeType(data) {
  return request('/notice-types', { method: 'POST', body: JSON.stringify(data) });
}

export function updateNoticeType(id, patch) {
  return request(`/notice-types/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteNoticeType(id) {
  return request(`/notice-types/${id}`, { method: 'DELETE' });
}

export function listStoreRules(workspaceId) {
  return request(`/store-rules?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createStoreRule(data) {
  return request('/store-rules', { method: 'POST', body: JSON.stringify(data) });
}

export function updateStoreRule(id, patch) {
  return request(`/store-rules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteStoreRule(id) {
  return request(`/store-rules/${id}`, { method: 'DELETE' });
}

export function listShoppingLists(workspaceId) {
  return request(`/shopping-lists?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createShoppingList(data) {
  return request('/shopping-lists', { method: 'POST', body: JSON.stringify(data) });
}

export function updateShoppingList(id, patch) {
  return request(`/shopping-lists/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteShoppingList(id) {
  return request(`/shopping-lists/${id}`, { method: 'DELETE' });
}

export function listShoppingItems(workspaceId) {
  return request(`/shopping-items?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createShoppingItems(listId, items) {
  return request('/shopping-items', {
    method: 'POST',
    body: JSON.stringify({ list_id: listId, items })
  });
}

export function updateShoppingItem(id, patch) {
  return request(`/shopping-items/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteShoppingItem(id) {
  return request(`/shopping-items/${id}`, { method: 'DELETE' });
}

export function listTasks(workspaceId) {
  return request(`/tasks?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function listTaskDependencies(workspaceId) {
  return request(`/task-dependencies?workspace_id=${encodeURIComponent(workspaceId)}`);
}

export function createTask(data) {
  return request('/tasks', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTask(id, patch) {
  return request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteTask(id) {
  return request(`/tasks/${id}`, { method: 'DELETE' });
}

export function reparentTask(id, newParentId) {
  return request(`/tasks/${id}/reparent`, {
    method: 'POST',
    body: JSON.stringify({ new_parent_id: newParentId ?? null })
  });
}

export function addTaskDependency(taskId, dependsOnId) {
  return request('/task-dependencies', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId, depends_on_id: dependsOnId })
  });
}

export function deleteTaskDependency(taskId, dependsOnId) {
  return request(`/task-dependencies/${encodeURIComponent(taskId)}/${encodeURIComponent(dependsOnId)}`, {
    method: 'DELETE'
  });
}

export function pullChanges(workspaceId, cursor = 0) {
  return request('/sync/pull', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, cursor })
  });
}

export function suggestTasks(payload) {
  return request('/ai/suggest', {
    method: 'POST',
    body: JSON.stringify(payload ?? {})
  });
}
