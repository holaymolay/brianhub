const API_BASE = 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || `Request failed: ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export function listWorkspaces() {
  return request('/workspaces');
}

export function createWorkspace(data) {
  return request('/workspaces', { method: 'POST', body: JSON.stringify(data) });
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
