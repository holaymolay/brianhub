import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../concepts/data-layer/migrations/runner.js';
import {
  createWorkspace,
  createTask,
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
