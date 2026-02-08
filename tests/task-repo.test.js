import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteClient } from '../concepts/data-layer/db/sqlite-client.js';
import { applyMigrations } from '../concepts/data-layer/migrations/runner.js';
import { TaskRepository } from '../concepts/data-layer/repos/task-repo.js';

const migrationsDir = 'concepts/data-layer/migrations';
const IDS = {
  orgA: '11111111-1111-4111-8111-111111111111',
  wsA: '22222222-2222-4222-8222-222222222222',
  orgB: '33333333-3333-4333-8333-333333333333',
  wsB: '44444444-4444-4444-8444-444444444444',
  t1: '55555555-5555-4555-8555-555555555555',
  t2: '66666666-6666-4666-8666-666666666666',
  t3: '77777777-7777-4777-8777-777777777777'
};

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
    await seedTenant(db, { orgId: IDS.orgA, workspaceId: IDS.wsA });
    await seedTenant(db, { orgId: IDS.orgB, workspaceId: IDS.wsB });

    const repo = new TaskRepository(db);
    await repo.create({ id: IDS.t1, title: 'A1', status: 'inbox' }, { orgId: IDS.orgA, workspaceId: IDS.wsA });
    await repo.create({ id: IDS.t2, title: 'A2', status: 'inbox' }, { orgId: IDS.orgA, workspaceId: IDS.wsA });
    await repo.create({ id: IDS.t3, title: 'B1', status: 'inbox' }, { orgId: IDS.orgB, workspaceId: IDS.wsB });

    const aTasks = await repo.list({ status: 'inbox' }, { orgId: IDS.orgA, workspaceId: IDS.wsA });
    const bTasks = await repo.list({ status: 'inbox' }, { orgId: IDS.orgB, workspaceId: IDS.wsB });

    assert.deepEqual(aTasks.map(t => t.id).sort(), [IDS.t1, IDS.t2]);
    assert.deepEqual(bTasks.map(t => t.id), [IDS.t3]);
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
      () => repo.list({}, { workspaceId: IDS.wsA }),
      /TenantCtx\.orgId required/
    );
  } finally {
    await db.close();
  }
});

test('TaskRepository rejects non-UUID tenant and task ids', async () => {
  const db = await createSqliteClient({ inMemory: true });
  try {
    await applyMigrations(db, migrationsDir);
    await seedTenant(db, { orgId: IDS.orgA, workspaceId: IDS.wsA });
    const repo = new TaskRepository(db);

    await assert.rejects(
      () => repo.list({}, { orgId: 'org-a', workspaceId: IDS.wsA }),
      /TenantCtx\.orgId must be a UUID/
    );

    await assert.rejects(
      () => repo.create({ id: 'task-a', title: 'Bad', status: 'inbox' }, { orgId: IDS.orgA, workspaceId: IDS.wsA }),
      /task\.id must be a UUID/
    );
  } finally {
    await db.close();
  }
});
