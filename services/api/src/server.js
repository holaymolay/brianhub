import Fastify from 'fastify';
import { openDb, migrate } from './db.js';
import {
  createWorkspace,
  listWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  createProject,
  listProjects,
  updateProject,
  deleteProject,
  createTemplate,
  listTemplates,
  updateTemplate,
  deleteTemplate,
  createShoppingList,
  listShoppingLists,
  updateShoppingList,
  deleteShoppingList,
  createShoppingItem,
  createShoppingItems,
  listShoppingItems,
  updateShoppingItem,
  deleteShoppingItem,
  listStatuses,
  createStatus,
  updateStatus,
  deleteStatus,
  listTaskTypes,
  createTaskType,
  updateTaskType,
  deleteTaskType,
  listNoticeTypes,
  createNoticeType,
  updateNoticeType,
  deleteNoticeType,
  listNotices,
  createNotice,
  updateNotice,
  deleteNotice,
  listStoreRules,
  createStoreRule,
  updateStoreRule,
  deleteStoreRule,
  createTask,
  getTask,
  updateTask,
  deleteTask,
  listTasks,
  listTaskDependencies,
  addTaskDependency,
  removeTaskDependency,
  getTaskTree,
  reparentTask,
  applyTaskCheckIn,
  rescheduleSubtree,
  searchTasks,
  recordChange
} from './taskService.js';

const server = Fastify({ logger: true });
const db = await openDb();
await migrate(db);

server.addHook('onRequest', (request, reply, done) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (request.method === 'OPTIONS') {
    reply.code(204).send();
    return;
  }
  done();
});

server.get('/health', async () => ({ ok: true }));

server.post('/workspaces', async (request, reply) => {
  const { name, type, org_id, org_name } = request.body ?? {};
  if (!name || !type) return reply.code(400).send({ error: 'name and type required' });
  return await createWorkspace(db, { name, type, org_id, org_name });
});

server.get('/workspaces', async (request) => {
  const { org_id } = request.query ?? {};
  return await listWorkspaces(db, org_id);
});

server.patch('/workspaces/:id', async (request, reply) => {
  const updated = await updateWorkspace(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/workspaces/:id', async (request, reply) => {
  const result = await deleteWorkspace(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/projects', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listProjects(db, workspace_id);
});

server.post('/projects', async (request, reply) => {
  const { workspace_id, name, kind } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  return await createProject(db, { workspace_id, name, kind });
});

server.patch('/projects/:id', async (request, reply) => {
  const updated = await updateProject(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/projects/:id', async (request, reply) => {
  const result = await deleteProject(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/templates', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listTemplates(db, workspace_id);
});

server.post('/templates', async (request, reply) => {
  const { workspace_id, name } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  return await createTemplate(db, request.body ?? {});
});

server.patch('/templates/:id', async (request, reply) => {
  const updated = await updateTemplate(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/templates/:id', async (request, reply) => {
  const result = await deleteTemplate(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/statuses', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listStatuses(db, workspace_id);
});

server.post('/statuses', async (request, reply) => {
  const { workspace_id, label } = request.body ?? {};
  if (!workspace_id || !label) {
    return reply.code(400).send({ error: 'workspace_id and label required' });
  }
  try {
    return await createStatus(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/statuses/:id', async (request, reply) => {
  const updated = await updateStatus(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/statuses/:id', async (request, reply) => {
  const result = await deleteStatus(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) {
    if (result?.error === 'protected') {
      return reply.code(400).send({ error: 'status is protected' });
    }
    return reply.code(404).send({ error: 'not found' });
  }
  return result;
});

server.get('/task-types', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listTaskTypes(db, workspace_id);
});

server.post('/task-types', async (request, reply) => {
  const { workspace_id, name } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  try {
    return await createTaskType(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/task-types/:id', async (request, reply) => {
  try {
    const updated = await updateTaskType(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/task-types/:id', async (request, reply) => {
  const result = await deleteTaskType(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) {
    if (result?.error === 'protected') {
      return reply.code(400).send({ error: 'type is protected' });
    }
    return reply.code(404).send({ error: 'not found' });
  }
  return result;
});

server.get('/notice-types', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listNoticeTypes(db, workspace_id);
});

server.post('/notice-types', async (request, reply) => {
  const { workspace_id, label } = request.body ?? {};
  if (!workspace_id || !label) {
    return reply.code(400).send({ error: 'workspace_id and label required' });
  }
  try {
    return await createNoticeType(db, { workspace_id, label }, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.patch('/notice-types/:id', async (request, reply) => {
  try {
    const updated = await updateNoticeType(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/notice-types/:id', async (request) => {
  return await deleteNoticeType(db, request.params.id, request.headers['x-client-id'] ?? null);
});

server.get('/notices', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listNotices(db, workspace_id);
});

server.post('/notices', async (request, reply) => {
  const { workspace_id, title, notify_at } = request.body ?? {};
  if (!workspace_id || !title || !notify_at) {
    return reply.code(400).send({ error: 'workspace_id, title, and notify_at required' });
  }
  return await createNotice(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
});

server.patch('/notices/:id', async (request, reply) => {
  const updated = await updateNotice(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/notices/:id', async (request, reply) => {
  const result = await deleteNotice(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/store-rules', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listStoreRules(db, workspace_id);
});

server.post('/store-rules', async (request, reply) => {
  const { workspace_id, store_name } = request.body ?? {};
  if (!workspace_id || !store_name) {
    return reply.code(400).send({ error: 'workspace_id and store_name required' });
  }
  return await createStoreRule(db, request.body ?? {}, request.headers['x-client-id'] ?? null);
});

server.patch('/store-rules/:id', async (request, reply) => {
  const updated = await updateStoreRule(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/store-rules/:id', async (request, reply) => {
  const result = await deleteStoreRule(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/shopping-lists', async (request) => {
  const { workspace_id } = request.query ?? {};
  return await listShoppingLists(db, workspace_id);
});

server.post('/shopping-lists', async (request, reply) => {
  const { workspace_id, name } = request.body ?? {};
  if (!workspace_id || !name) {
    return reply.code(400).send({ error: 'workspace_id and name required' });
  }
  return await createShoppingList(db, { workspace_id, name, archived: request.body?.archived }, request.headers['x-client-id'] ?? null);
});

server.patch('/shopping-lists/:id', async (request, reply) => {
  const updated = await updateShoppingList(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/shopping-lists/:id', async (request, reply) => {
  const result = await deleteShoppingList(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.get('/shopping-items', async (request) => {
  const { workspace_id, list_id } = request.query ?? {};
  return await listShoppingItems(db, workspace_id, list_id ?? null);
});

server.post('/shopping-items', async (request, reply) => {
  const { list_id, name, items } = request.body ?? {};
  if (!list_id) {
    return reply.code(400).send({ error: 'list_id required' });
  }
  if (Array.isArray(items) && items.length) {
    return { items: await createShoppingItems(db, list_id, items, request.headers['x-client-id'] ?? null) };
  }
  if (!name) {
    return reply.code(400).send({ error: 'name required' });
  }
  const created = await createShoppingItem(db, { list_id, name }, request.headers['x-client-id'] ?? null);
  if (!created) return reply.code(404).send({ error: 'list not found' });
  return created;
});

server.patch('/shopping-items/:id', async (request, reply) => {
  const updated = await updateShoppingItem(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
  if (!updated) return reply.code(404).send({ error: 'not found' });
  return updated;
});

server.delete('/shopping-items/:id', async (request, reply) => {
  const result = await deleteShoppingItem(db, request.params.id, request.headers['x-client-id'] ?? null);
  if (!result || result.deleted === 0) return reply.code(404).send({ error: 'not found' });
  return result;
});

server.post('/tasks', async (request, reply) => {
  const data = request.body ?? {};
  if (!data.workspace_id || !data.title) {
    return reply.code(400).send({ error: 'workspace_id and title required' });
  }
  try {
    return await createTask(db, data, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/tasks/:id', async (request, reply) => {
  const task = await getTask(db, request.params.id);
  if (!task) return reply.code(404).send({ error: 'not found' });
  return task;
});

server.patch('/tasks/:id', async (request, reply) => {
  try {
    const updated = await updateTask(db, request.params.id, request.body ?? {}, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/tasks/:id', async (request) => {
  return await deleteTask(db, request.params.id, request.headers['x-client-id'] ?? null);
});

server.get('/tasks', async (request) => {
  const { workspace_id } = request.query;
  return await listTasks(db, workspace_id);
});

server.get('/task-dependencies', async (request) => {
  const { workspace_id } = request.query;
  return await listTaskDependencies(db, workspace_id);
});

server.post('/task-dependencies', async (request, reply) => {
  const { task_id, depends_on_id } = request.body ?? {};
  if (!task_id || !depends_on_id) {
    return reply.code(400).send({ error: 'task_id and depends_on_id required' });
  }
  try {
    return await addTaskDependency(db, task_id, depends_on_id, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.delete('/task-dependencies/:taskId/:dependsOnId', async (request, reply) => {
  try {
    return await removeTaskDependency(
      db,
      request.params.taskId,
      request.params.dependsOnId,
      request.headers['x-client-id'] ?? null
    );
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.get('/tasks/tree', async (request) => {
  const { workspace_id, root_id } = request.query;
  return await getTaskTree(db, workspace_id, root_id ?? null);
});

server.post('/tasks/:id/reparent', async (request, reply) => {
  const { new_parent_id } = request.body ?? {};
  try {
    return await reparentTask(db, request.params.id, new_parent_id ?? null, request.headers['x-client-id'] ?? null);
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/tasks/:id/checkin', async (request, reply) => {
  const { response } = request.body ?? {};
  try {
    const updated = await applyTaskCheckIn(db, request.params.id, response, request.headers['x-client-id'] ?? null);
    if (!updated) return reply.code(404).send({ error: 'not found' });
    return updated;
  } catch (err) {
    return reply.code(400).send({ error: err.message });
  }
});

server.post('/tasks/:id/reschedule', async (request, reply) => {
  const { deltaMs } = request.body ?? {};
  if (typeof deltaMs !== 'number') return reply.code(400).send({ error: 'deltaMs required' });
  return await rescheduleSubtree(db, request.params.id, deltaMs, request.headers['x-client-id'] ?? null);
});

server.post('/tasks/search', async (request) => {
  const { workspace_id, text, status, tag } = request.body ?? {};
  return await searchTasks(db, workspace_id, { text, status, tag });
});

server.post('/sync/push', async (request) => {
  const { workspace_id, client_id, changes } = request.body ?? {};
  const applied = [];
  if (Array.isArray(changes)) {
    for (const change of changes) {
      await recordChange(db, workspace_id, change.entity_type, change.entity_id, change.action, change.payload, client_id ?? null);
      applied.push(change);
    }
  }
  return { applied: applied.length };
});

server.post('/sync/pull', async (request) => {
  const { workspace_id, cursor } = request.body ?? {};
  const rows = await db.query(
    'SELECT seq, entity_type, entity_id, action, payload, client_id, created_at FROM change_log WHERE workspace_id = ? AND seq > ? ORDER BY seq ASC',
    [workspace_id, cursor ?? 0]
  );
  const changes = rows.map(row => ({
    seq: row.seq,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    action: row.action,
    payload: JSON.parse(row.payload),
    client_id: row.client_id,
    created_at: row.created_at
  }));
  const nextCursor = rows.length ? rows[rows.length - 1].seq : cursor ?? 0;
  return { changes, next_cursor: nextCursor };
});

server.post('/ai/suggest', async (request) => {
  const { tasks, context } = request.body ?? {};
  const suggestions = [];
  if (Array.isArray(tasks)) {
    const next = tasks.find(task => task.status !== 'done' && task.status !== 'canceled');
    if (next) {
      suggestions.push({
        type: 'next-action',
        task_id: next.id,
        message: `Focus on "${next.title}" next.`
      });
    }
  }
  if (context?.time_available_minutes) {
    suggestions.push({
      type: 'time-block',
      message: `You have ${context.time_available_minutes} minutes. Pick a task that fits that window.`
    });
  }
  return { suggestions, notes: 'AI stub only; no state mutation.' };
});

const port = Number(process.env.PORT ?? 3000);
server.listen({ port, host: '0.0.0.0' });
