import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../concepts/data-layer/migrations/runner.js';
import {
  createWorkspace,
  createTask,
  createProject,
  createStatus,
  createTaskType,
  listTasks,
  getTask
} from '../services/api/src/taskService.js';

const migrationsDir = 'services/api/db/migrations';

async function withDb(fn) {
  const db = await createSqliteClient({ inMemory: true });
  try {
    await applyMigrations(db, migrationsDir);
    await fn(db);
  } finally {
    await db.close();
  }
}

test('task service works with DbClient interface', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { name: 'Workspace', type: 'personal' });
    assert.ok(workspace?.id);

    const task = await createTask(db, { workspace_id: workspace.id, title: 'Task 1' });
    assert.equal(task.title, 'Task 1');

    const fetched = await getTask(db, task.id);
    assert.equal(fetched.id, task.id);

    const tasks = await listTasks(db, workspace.id);
    assert.equal(tasks.length, 1);
  });
});

test('createWorkspace and createTask honor provided ids', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { id: 'ws-local', name: 'Offline', type: 'personal' });
    assert.equal(workspace.id, 'ws-local');

    const task = await createTask(db, { id: 'task-local', workspace_id: workspace.id, title: 'Offline Task' });
    assert.equal(task.id, 'task-local');

    const fetched = await getTask(db, 'task-local');
    assert.equal(fetched.id, 'task-local');
  });
});

test('createProject/status/taskType honor provided ids', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { id: 'ws-seed', name: 'Seed', type: 'personal' });

    const project = await createProject(db, { id: 'proj-local', workspace_id: workspace.id, name: 'Project' });
    assert.equal(project.id, 'proj-local');

    const status = await createStatus(db, { id: 'status-local', workspace_id: workspace.id, label: 'Custom' });
    assert.equal(status.id, 'status-local');

    const taskType = await createTaskType(db, { id: 'type-local', workspace_id: workspace.id, name: 'Type' });
    assert.equal(taskType.id, 'type-local');
  });
});
