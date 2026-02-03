import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../concepts/data-layer/migrations/runner.js';
import { TaskRepository } from '../concepts/data-layer/repos/task-repo.js';

const migrationsDir = 'concepts/data-layer/migrations';

async function seedTenant(db, { orgId, workspaceId }) {
  await db.exec('INSERT INTO orgs (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    orgId,
    'Org',
    new Date().toISOString(),
    new Date().toISOString()
  ]);
  await db.exec('INSERT INTO workspaces (id, org_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    workspaceId,
    orgId,
    'Workspace',
    new Date().toISOString(),
    new Date().toISOString()
  ]);
}

test('TaskRepository scopes by tenant context', async () => {
  const db = await createSqliteClient({ inMemory: true });
  try {
    await applyMigrations(db, migrationsDir);
    await seedTenant(db, { orgId: 'org-a', workspaceId: 'ws-a' });
    await seedTenant(db, { orgId: 'org-b', workspaceId: 'ws-b' });

    const repo = new TaskRepository(db);
    await repo.create({ id: 't1', title: 'A1', status: 'inbox' }, { orgId: 'org-a', workspaceId: 'ws-a' });
    await repo.create({ id: 't2', title: 'A2', status: 'inbox' }, { orgId: 'org-a', workspaceId: 'ws-a' });
    await repo.create({ id: 't3', title: 'B1', status: 'inbox' }, { orgId: 'org-b', workspaceId: 'ws-b' });

    const aTasks = await repo.list({ status: 'inbox' }, { orgId: 'org-a', workspaceId: 'ws-a' });
    const bTasks = await repo.list({ status: 'inbox' }, { orgId: 'org-b', workspaceId: 'ws-b' });

    assert.deepEqual(aTasks.map(t => t.id).sort(), ['t1', 't2']);
    assert.deepEqual(bTasks.map(t => t.id), ['t3']);
  } finally {
    await db.close();
  }
});

test('TaskRepository requires orgId in TenantCtx', async () => {
  const db = await createSqliteClient({ inMemory: true });
  try {
    await applyMigrations(db, migrationsDir);
    const repo = new TaskRepository(db);
    await assert.rejects(
      () => repo.list({}, { workspaceId: 'ws-a' }),
      /TenantCtx\.orgId required/
    );
  } finally {
    await db.close();
  }
});
