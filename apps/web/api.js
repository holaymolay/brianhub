const API_BASE = 'http://localhost:3000';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
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

export function listTasks(workspaceId) {
  return request(`/tasks?workspace_id=${encodeURIComponent(workspaceId)}`);
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
