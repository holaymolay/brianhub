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
const IDS = {
  workspaceLocal: '11111111-1111-4111-8111-111111111111',
  taskLocal: '22222222-2222-4222-8222-222222222222',
  workspaceSeed: '33333333-3333-4333-8333-333333333333',
  projectLocal: '44444444-4444-4444-8444-444444444444',
  statusLocal: '55555555-5555-4555-8555-555555555555',
  typeLocal: '66666666-6666-4666-8666-666666666666'
};

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
    const workspace = await createWorkspace(db, { id: IDS.workspaceLocal, name: 'Offline', type: 'personal' });
    assert.equal(workspace.id, IDS.workspaceLocal);

    const task = await createTask(db, { id: IDS.taskLocal, workspace_id: workspace.id, title: 'Offline Task' });
    assert.equal(task.id, IDS.taskLocal);

    const fetched = await getTask(db, IDS.taskLocal);
    assert.equal(fetched.id, IDS.taskLocal);
  });
});

test('createProject/status/taskType honor provided ids', async () => {
  await withDb(async (db) => {
    const workspace = await createWorkspace(db, { id: IDS.workspaceSeed, name: 'Seed', type: 'personal' });

    const project = await createProject(db, { id: IDS.projectLocal, workspace_id: workspace.id, name: 'Project' });
    assert.equal(project.id, IDS.projectLocal);

    const status = await createStatus(db, { id: IDS.statusLocal, workspace_id: workspace.id, label: 'Custom' });
    assert.equal(status.id, IDS.statusLocal);

    const taskType = await createTaskType(db, { id: IDS.typeLocal, workspace_id: workspace.id, name: 'Type' });
    assert.equal(taskType.id, IDS.typeLocal);
  });
});

test('create APIs reject invalid ids', async () => {
  await withDb(async (db) => {
    await assert.rejects(
      () => createWorkspace(db, { id: 'ws-local', name: 'Offline', type: 'personal' }),
      /Invalid workspace id/
    );

    const workspace = await createWorkspace(db, { name: 'Workspace', type: 'personal' });

    await assert.rejects(
      () => createTask(db, { id: 'task-local', workspace_id: workspace.id, title: 'Task' }),
      /Invalid task id/
    );

    await assert.rejects(
      () => createProject(db, { id: 'proj-local', workspace_id: workspace.id, name: 'Project' }),
      /Invalid project id/
    );
  });
});
